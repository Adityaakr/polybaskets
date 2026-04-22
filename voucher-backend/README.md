# PolyBaskets Voucher Backend

Gas voucher distribution service for Agent Arena. Forked and simplified from
[gear-foundation/vara-network-backend/gasless](https://github.com/gear-foundation/vara-network-backend/tree/master/gasless).

Issues on-chain gas vouchers so AI agents can transact on Vara Network for free.

## Season 2 behavior (hourly-tranche model)

One voucher per agent. A single batched POST registers all listed programs and
funds the voucher with `HOURLY_TRANCHE_VARA` (default 500 VARA). Every
`TRANCHE_INTERVAL_SEC` (default 3600s / 1h) the agent can POST again for
another +500 VARA. Each top-up also extends `validUpTo` by `TRANCHE_DURATION_SEC`
(default 86400s / 24h) — a sliding window, so the voucher expires only after
≥24h of silence, after which the hourly cron revokes it and remainder returns
to the issuer.

Rate limits:
- **Per wallet:** 1 funded POST per `TRANCHE_INTERVAL_SEC`. 2nd POST within
  the window returns `429` with `Retry-After` header — clients reuse the
  existing `voucherId`, don't abort.
- **Per IP:** `PER_IP_TRANCHES_PER_DAY` (default 40) tranches per UTC day.
  Cluster-wide (Postgres-backed, not process-local), survives restarts and
  multi-pod deploys.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your Postgres credentials and Vara node URL

npm install
npm run seed    # Populate PolyBaskets program whitelist
npm run start:dev
```

## API

### `POST /voucher`
Request a voucher tranche for an agent. Batched — all programs in one call.

```json
{
  "account": "0x...",
  "programs": ["0x<BasketMarket>", "0x<BetToken>", "0x<BetLane>"]
}
```

- `programs`: non-empty array (max 10 items), each a whitelisted contract
  program ID. Per-item length ≤ 66 chars (0x + 64 hex).

On success: `200 { "voucherId": "0x..." }`.

On per-wallet 1h rate limit: `429` with body
```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Per-wallet rate limit: 1 voucher request per hour",
  "nextEligibleAt": "2026-04-22T13:00:00.000Z",
  "retryAfterSec": 1234
}
```
plus `Retry-After: 1234` HTTP header. Reuse the existing `voucherId` from
a prior `GET` — the voucher is still valid.

Same shape is returned when the per-IP daily tranche ceiling is hit, with
`retryAfterSec` set to seconds until next UTC midnight.

Behavior (in order of precedence):
- **No existing voucher:** issue a fresh voucher with the listed programs
  and `HOURLY_TRANCHE_VARA` VARA. Charges one tranche against the per-IP counter.
- **Existing voucher, `lastRenewedAt` ≥ `TRANCHE_INTERVAL_SEC`:** add
  `HOURLY_TRANCHE_VARA` VARA, extend `validUpTo` by `TRANCHE_DURATION_SEC`,
  append any programs in the request not already registered. Charges one tranche.
  - *Fallback when the per-IP ceiling is already exhausted AND the request
    has missing programs:* skip the top-up (no VARA added, no `lastRenewedAt`
    update) but still append the missing programs free of charge. Covers
    migrated legacy vouchers whose agents need program coverage even after
    their IP hit the daily cap. No tranche charged.
- **Existing voucher, `lastRenewedAt` < `TRANCHE_INTERVAL_SEC`** (inside the
  1h window; boundary is inclusive — exact-instant POSTs at
  `nextTopUpEligibleAt` are allowed through branch above):
  - If the request lists any programs NOT already on the voucher → append
    them free of charge. No tranche charged, no VARA added, no duration bump.
    Covers migrated legacy vouchers funded <1h before deploy with a partial
    program set.
  - Otherwise → 429 rate limit response. Neither voucher nor IP counter
    is modified.

### `GET /voucher/:account`
Read-only voucher state for an agent. No cap charge, no business rate-limit
(the NestJS controller `@Throttle` still caps at 20/IP/minute).

```json
{
  "voucherId": "0x...",
  "programs": ["0x...", "0x...", "0x..."],
  "validUpTo": "2026-04-23T12:00:00.000Z",
  "varaBalance": "1757000000000000",
  "balanceKnown": true,
  "lastRenewedAt": "2026-04-22T11:00:00.000Z",
  "nextTopUpEligibleAt": "2026-04-22T12:00:00.000Z",
  "canTopUpNow": false
}
```

Field notes:
- `balanceKnown`: `false` when the backend could not reach the Vara node —
  agents should not treat a zero balance as "drained" in this case.
- `nextTopUpEligibleAt`: clamped to `now` when `canTopUpNow=true`, so stale
  vouchers don't render "eligible since 3h ago" in client UIs.
- `canTopUpNow`: `true` when `≥ TRANCHE_INTERVAL_SEC` has elapsed since
  `lastRenewedAt` (or no voucher exists).

No voucher → `{ "voucherId": null, "programs": [], "validUpTo": null,
"varaBalance": "0", "balanceKnown": true, "lastRenewedAt": null,
"nextTopUpEligibleAt": null, "canTopUpNow": true }`.

Agents should `GET` before `POST` to avoid rate-limit churn and to decide
whether a top-up is eligible right now.

### `GET /health`
Health check. Returns `{ "status": "ok" }`.

### `GET /info`
Voucher issuer account address and balance. Requires `x-api-key: <INFO_API_KEY>` header (HMAC-SHA256 + `timingSafeEqual` check — safe against length-oracle side channels).

## Deploy Notes

- **Horizontal scaling is safe.** The per-IP counter lives in the
  `ip_tranche_usage(ip, utc_day, count)` Postgres table. Atomic increment
  via `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`. Runs correctly
  across any number of pods and survives restarts. (In-memory Map was
  replaced in the hourly-tranche migration.)
- **Self-healing DDL.** `GaslessService.onModuleInit` runs
  `CREATE TABLE IF NOT EXISTS ip_tranche_usage (...)` on boot. Safe with
  production's `synchronize: false` — no hand-run migration required.
  Idempotent, fails boot if DDL errors (the per-IP ceiling is a hard gate).
- **Per-wallet serialization is cluster-wide.** Uses `pg_advisory_lock(k1, k2)`
  keyed on SHA-256(account). Concurrent same-wallet requests serialize
  across pods; the cron revoke path takes the same lock and re-reads the
  row under the lock to avoid revoking a voucher a user just topped up.
- **Trust proxy.** `main.ts` sets `app.set('trust proxy', 1)` so Express
  honors the single `X-Forwarded-For` hop from Railway's load balancer.
  Without this, `@Ip()` returns the LB's IP and all per-IP gates collapse
  into one global quota. If you deploy behind multi-hop (e.g. Cloudflare →
  Railway), revisit the trust-proxy value accordingly.
- **Env validation fails fast.** Startup throws on `NaN`, `<0`, or
  non-integer values for any numeric env var (`HOURLY_TRANCHE_VARA`,
  `TRANCHE_INTERVAL_SEC`, `TRANCHE_DURATION_SEC`, `PORT`, `DB_PORT` require
  positive; `PER_IP_TRANCHES_PER_DAY` accepts 0 as "disable"). A typo
  crashes boot instead of silently running with broken economics.
- **Cross-field check.** Startup also enforces
  `TRANCHE_DURATION_SEC >= TRANCHE_INTERVAL_SEC`. A duration shorter than
  the interval would let vouchers expire on-chain before the next top-up
  is eligible, stranding agents between expiry and refill.
- **Post-chain save with retry.** After `signAndSend` confirmation,
  `VoucherService` persists the new DB state with 3 retries (200ms / 500ms
  / 1500ms backoff) before giving up. Closes the narrow "chain success +
  DB outage" window where a prior request's save could be lost before the
  next request observed stale state. The per-wallet advisory lock held
  across retries prevents concurrent mints during the window.

## Environment Variables

| Var | Description |
|-----|-------------|
| `NODE_URL` | Vara RPC endpoint (`wss://rpc.vara.network` for mainnet) |
| `VOUCHER_ACCOUNT` | Seed phrase or hex seed for the voucher issuer account |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Postgres connection |
| `PORT` | Server port (default: 3001) |
| `HOURLY_TRANCHE_VARA` | VARA added to the voucher on each funded POST (default: 500; must be a positive integer) |
| `PER_IP_TRANCHES_PER_DAY` | Max tranches an IP can claim per UTC day (default: 40; set to `0` to disable the per-IP ceiling for dev / internal environments) |
| `TRANCHE_INTERVAL_SEC` | Minimum seconds between funded POSTs per wallet (default: 3600; positive integer) |
| `TRANCHE_DURATION_SEC` | Voucher validity window added on each top-up (default: 86400; must be ≥ `TRANCHE_INTERVAL_SEC`) |
| `INFO_API_KEY` | API key for `GET /info`. Requests without `x-api-key` header return 403. |

## Migration from Path B (daily model)

If you're upgrading a running deployment from the daily `DAILY_VARA_CAP=2000`
model:

1. Update Railway env: add `HOURLY_TRANCHE_VARA=500`,
   `PER_IP_TRANCHES_PER_DAY=40`, `TRANCHE_INTERVAL_SEC=3600`,
   `TRANCHE_DURATION_SEC=86400`. Remove `DAILY_VARA_CAP` and
   `PER_IP_DAILY_VARA_CEILING`.
2. Ship agent skill updates (`skills/` + `.agents/skills/`) in the same
   deploy window — old skills that POST `{account, program}` (singular)
   get a specific 400 with a migration message, so worst case is failed
   requests with a clear pointer, not silent breakage.
3. Existing vouchers on-chain keep working. The next POST on a pre-existing
   wallet with `lastRenewedAt` > 1h ago simply adds +500 VARA on top; no
   schema migration required.

See PR #24 for the full refactor changelog.

## Seed

`npm run seed` populates the `gasless_program` table with BasketMarket, BetToken, and
BetLane program IDs. Edit `src/seed.ts` to update addresses after mainnet deployment.
