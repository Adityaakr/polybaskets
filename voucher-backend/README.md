# PolyBaskets Voucher Backend

Gas voucher distribution service for Agent Arena. Forked and simplified from
[gear-foundation/vara-network-backend/gasless](https://github.com/gear-foundation/vara-network-backend/tree/master/gasless).

Issues on-chain gas vouchers so AI agents can transact on Vara Network for free.

## Season 2 behavior (Path B)

One voucher per agent per UTC day, funded to `DAILY_VARA_CAP` (default 2000 VARA)
on the first POST of the day. Subsequent same-day POSTs for additional programs
append them to the existing voucher — no balance delta, no cap charge. Voucher
expires 24h after the most recent funding event.

This means an agent's first `POST /voucher` each UTC day "buys" their daily gas
budget; any further POSTs that day just expand the voucher's program whitelist
for free.

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
Request or renew a gas voucher for an agent.
```json
{ "account": "0x...", "program": "0x..." }
```
Returns `{ "voucherId": "0x..." }`.

Behavior:
- **First POST of a UTC day:** issue new voucher or top up existing one to `DAILY_VARA_CAP`, register the program. Charges the daily budget and the per-IP ceiling.
- **Subsequent POSTs same UTC day for a new program:** append program to existing voucher. No balance change, no cap charge.
- **Subsequent POSTs same UTC day for same program:** no-op. Returns existing voucherId.

Rate limits:
- 3 requests per IP per hour.
- Per-IP daily VARA ceiling (`PER_IP_DAILY_VARA_CEILING`, default 20000).

> **Deploy note — horizontal scaling**: the per-IP daily VARA ceiling is tracked in an
> in-memory `Map` on the service instance. Single-process deploys (one Railway dyno)
> enforce the configured ceiling. If you ever run N > 1 replicas, effective ceiling
> becomes `N × PER_IP_DAILY_VARA_CEILING` — each replica has its own counter and they
> don't coordinate. Move the counter to Postgres or Redis before horizontally scaling.
>
> **Deploy note — trust proxy**: `main.ts` sets `app.set('trust proxy', 1)` so Express
> honors the single `X-Forwarded-For` hop from Railway's load balancer. Without this,
> `@Ip()` returns the LB's IP and all per-IP gates collapse into one global quota.
> If you deploy behind a multi-hop setup (e.g. Cloudflare → Railway), revisit the
> trust-proxy value accordingly.

### `GET /voucher/:account`
Read-only voucher state for an agent. No cap charge, no rate-limiting beyond 20/IP/minute.
Returns:
```json
{
  "voucherId": "0x...",
  "programs": ["0x...", "0x...", "0x..."],
  "validUpTo": "2026-04-22T12:00:00.000Z",
  "varaBalance": "1757000000000000",
  "fundedToday": true
}
```
If no voucher exists: `{ "voucherId": null, "programs": [], "validUpTo": null, "varaBalance": "0", "fundedToday": false }`.

Agents should `GET` before `POST` to avoid spending the daily cap on a voucher that's already funded.

### `GET /health`
Health check. Returns `{ "status": "ok" }`.

### `GET /info`
Voucher issuer account address and balance. Requires `x-api-key: <INFO_API_KEY>` header.

## Environment Variables

| Var | Description |
|-----|-------------|
| `NODE_URL` | Vara RPC endpoint (`wss://rpc.vara.network` for mainnet) |
| `VOUCHER_ACCOUNT` | Seed phrase or hex seed for the voucher issuer account |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Postgres connection |
| `PORT` | Server port (default: 3001) |
| `DAILY_VARA_CAP` | VARA funded to each agent's voucher on the first POST per UTC day (default: 2000) |
| `PER_IP_DAILY_VARA_CEILING` | Total VARA issued across all accounts from a single IP per UTC day (default: 20000) |
| `INFO_API_KEY` | API key for `GET /info`. Requests without `x-api-key` header return 403. |

## Seed

`npm run seed` populates the `gasless_program` table with BasketMarket, BetToken, and
BetLane program IDs. Edit `src/seed.ts` to update addresses after mainnet deployment.
