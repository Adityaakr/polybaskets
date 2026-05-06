# Agent ENS Subname Registrar — Design

**Date:** 2026-05-06
**Status:** Draft, awaiting review
**Scope:** voucher-backend (NestJS) + STARTER_PROMPT.md
**PR shape:** lean, single new module, no edits to `gasless/`

## Goal

Every agent that registers a name on the BasketMarket contract also gets a
matching ENS subname under `polybaskets.eth` (e.g. `happy.polybaskets.eth`),
with optional profile fields (description, twitter, avatar, etc.). The subname
becomes the source of truth for human-facing agent identity across ENS-aware
tools and reverse-lookup by Vara address.

ENS subname creation is **mandatory** in the agent boot sequence
(STARTER_PROMPT): every agent calls `BasketMarket.RegisterAgent` on-chain
(signed by the agent, gas paid by their voucher) and then immediately POSTs
to the new endpoint to claim the matching subname. The endpoint is
**verify-only**: it reads on-chain `getAgent(account)`, confirms `name`
matches the request, and writes the subname. The reconciler (below) closes
the gap if an agent registers on-chain but never reaches the endpoint.

## Non-goals

- Replacing the on-chain `BasketMarket.getAgent(addr)` registry. On-chain
  remains authoritative for `address → name`.
- Per-field signature auth. We trust on-chain registration as the auth source.
- Migrating ENS records on-chain. Subnames stay off-chain via
  `@thenamespace/offchain-manager`.

## Trust model

On-chain `BasketMarket.RegisterAgent` is the only auth gate. Every endpoint
either *causes* an on-chain registration (via the backend signer) or *verifies*
that the on-chain `agent.name` for the caller still matches the subname label.
No new keys, no signed payloads, no nonce store.

Blast radius is identical to the existing `RegisterAgent` extrinsic: an
attacker who could spam this endpoint can only create or overwrite their own
subname / profile, never someone else's.

## Architecture

### New module (no edits to existing modules)

```
voucher-backend/src/agent-registrar/
  agent-registrar.module.ts
  agent-registrar.controller.ts
  agent-registrar.service.ts
  offchain-manager.client.ts        # singleton wrapper around the SDK
  vara-agent.reader.ts              # read-only on-chain lookup
  agent-registrar.migration.ts      # MIGRATION_ENABLED one-shot
  dto/
    register-agent.dto.ts
    update-profile.dto.ts
```

`AppModule` gains one import line for `AgentRegistrarModule`. Nothing in
`gasless/` changes.

### External dependency

```
npm install @thenamespace/offchain-manager
```

Loaded once in `offchain-manager.client.ts` from the `NAMESPACE_API_KEY` env
var. The client instance is held as a Nest provider, never re-initialized per
request, never echoed in logs or responses.

### Existing infrastructure reused

- `BasketMarket` Sails program — read `getAgent`, `getAllAgents`. **No write
  calls**; the agent signs `RegisterAgent` themselves with their own voucher.
- `GearApi` connection pattern (reconnect-on-disconnect) — copied from
  `voucher.service.ts` style, not imported, to keep the new module standalone.
- Throttler — global guard already wired in `app.module.ts`.

## Endpoints

All routes share the global `ThrottlerGuard`. Per-route limits below.

### `POST /agent/register` — 6/IP/hour

Body:

```json
{
  "account": "kGk...vara-ss58",
  "name": "happy",
  "profile": { /* optional, see Profile fields */ }
}
```

Flow:

1. Validate `name`: lowercase, 3–20 chars, `[a-z0-9-]`, not in reserved set
   (`default`, `admin`, `polybaskets`, `root`, `ens`, `system`).
2. Decode `account` (Vara SS58 → 0x hex). Reject malformed.
3. Read on-chain `getAgent(account)`. Poll up to 60s for finality lag.
   - If `agent` is `null` → 409 `not registered on-chain; call RegisterAgent
     first`.
   - If `agent.name != name` → 409 `on-chain name mismatch (got "X")`.
4. `client.isSubnameAvailable("${name}.polybaskets.eth")`:
   - Available → `createSubname(...)`.
   - Taken & metadata `varaAddress == account` → `setRecords(...)` (overwrite,
     idempotent).
   - Taken & metadata `varaAddress != account` → 409 `subname taken by another
     account` (rare; only happens if someone manually claimed the label
     out-of-band via Namespace).
5. Return `{ fullName: "happy.polybaskets.eth", varaAddress }`.

If on-chain finality polling exceeds 60s, return `202 { status: "pending" }`.
The reconciler will pick it up once `getAllAgents()` reflects the registration.

Per-IP gate: 5 successful registers / IP / UTC day. Reuses the
`reserveIpTrancheCount` pattern but on a separate counter (`ip_agent_registers`
column or a small in-memory map — see "Storage" below).

Per-account gate: enforced by on-chain `name_updated_at` rate limit, no
backend-side per-wallet store.

### `PATCH /agent/profile` — 12/IP/hour

Body:

```json
{
  "account": "kGk...vara-ss58",
  "profile": { /* fields to set; null to delete a key */ }
}
```

Flow:

1. Decode `account`. Read on-chain `getAgent(account)` → must exist.
2. Look up subname by metadata `varaAddress = account` (using
   `getFilteredSubnames`). Subname `label` must equal `agent.name` — if it
   doesn't, the agent renamed on-chain after the last subname write; reject
   with `409 stale subname; call POST /agent/register first`.
3. `setRecords(...)` with the supplied texts/addresses. Keys with `null`
   values are explicitly removed.
4. Return `{ fullName, updatedKeys }`.

### `GET /agent/profile/:account` — 20/IP/min

Convenience reverse-lookup. Returns `{ fullName, name, texts, addresses,
metadata }`. Cached in-memory 60s by account. Mirrors the `GET /voucher/:account`
read pattern.

## Profile fields (ENSIP-compliant, pass-through)

Per the user requirement "supports any and everything": the API does not
hard-code a profile schema. The backend accepts arbitrary text and address
records and forwards them to the SDK. Validation is **format only**, not
**vocabulary**.

### Texts

`profile.texts` is an object `{ [key: string]: string | null }`.

- Key validation: 1–64 chars, `[a-zA-Z0-9._-]` (matches ENSIP-5 conventions).
- Value validation: 0–4096 chars (ENS resolver value cap). `null` = delete.
- Recommended key set, surfaced in STARTER_PROMPT.md so agents pick the right
  ones (not enforced):
  - **ENSIP-5 standard:** `name`, `description`, `avatar`, `url`, `email`,
    `notice`, `keywords`, `location`.
  - **Social (de-facto namespaced):** `com.twitter`, `com.github`,
    `com.discord`, `com.reddit`, `org.telegram`, `com.linkedin`.
  - **Polybaskets-specific:** `polybaskets.strategy` (free-form, e.g.
    "high-conviction-crypto"), `polybaskets.varaAddress` (mirror of metadata).

### Addresses

`profile.addresses` is an array `[{ chain: string, value: string }]` matching
the SDK's `addresses` shape. Allowed `chain` values follow ENSIP-9 / ENSIP-11
SLIP-44 names exposed by the SDK's `ChainName` enum (`Ethereum`, `Polygon`,
`Bitcoin`, etc.). The most common — and the one we surface in the prompt — is
`Ethereum`, set from `profile.ethAddress` if the agent provided one.

### Metadata (server-controlled)

The backend always writes:

- `varaAddress` = decoded 0x hex of the agent's Vara account. Used for
  reverse-lookup queries.

Agents may not set or override metadata. Any `metadata` key in the request body
is ignored.

### Default record set

If `profile` is omitted, the subname is created with:

- texts: `{ name: "<label>" }`
- addresses: `[{ Ethereum: POLYBASKETS_OWNER_EVM }]` (so ENS resolvers don't
  return empty)
- metadata: `{ varaAddress: "<0xhex>" }`

Agents fill in the rest later via `PATCH /agent/profile`.

## Storage

No new entities. Three options for the per-IP register cap:

- **In-memory `Map<ip, { day, count }>`** — restart-permissive, matches the
  voucher service's IP gate. **Chosen.** Register volume is much lower than
  voucher volume (one per agent lifetime), so the map size stays trivially
  small.
- Reuse `ip_tranche_usage` with a synthetic key prefix — pollutes the table.
- New table `ip_agent_register_usage` — overkill for the volume.

No pending queue is built. Two reconciliation paths instead:

1. **Inline blocking poll** inside `POST /agent/register`. The endpoint polls
   on-chain finality for up to 60 seconds (a small fixed cap independent of
   `AGENT_RETRY_*`). Realistic Vara finality is single-digit seconds, so this
   covers the common case. On success, returns `200`.
2. **Periodic reconciler** (`@Cron(EVERY_30_SECONDS)`, gated by
   `AGENT_RETRY_INTERVAL_MS`). Calls `getAllAgents()`, diffs against existing
   subnames (queried by metadata `varaAddress`), creates the missing ones with
   default record set. This is the **same code path** as the migration job;
   the only difference is the trigger (`@Cron` vs. one-shot `onModuleInit`).
   Bounded by `AGENT_RETRY_MAX_ATTEMPTS` per agent (tracked in-memory; on
   process restart, the count resets — acceptable, the work is idempotent).

Endpoint behavior when inline poll exceeds 60s:

- On-chain register succeeded → return `202 { fullName: "<name>.polybaskets.eth",
  status: "pending" }`. The reconciler will create the subname within
  `AGENT_RETRY_INTERVAL_MS`.
- On-chain register not yet visible → return `202 { status: "pending" }` with
  the same shape. The reconciler picks it up once `getAllAgents()` reflects
  the registration.

Agents treat `202` as "continue, do not abort" — the STARTER_PROMPT calls this
out explicitly.

## Migration / reconciliation

A single function — `reconcileAgents(agents: AgentInfo[])` — does the work:

1. For each `(address, name)`:
   - Skip if `getFilteredSubnames({ parentName, owner: POLYBASKETS_OWNER_EVM,
     metadata: { varaAddress: address } })` returns a hit.
   - Else `createSubname` with default record set (no profile fields).
2. Return a summary `{ total, created, skipped, failed }`.

Two callers:

- **One-shot migration**, `onModuleInit`, gated by `MIGRATION_ENABLED=true`.
  Calls `getAllAgents()` then `reconcileAgents(...)`. Logs the summary.
  Operator flips back to `false` after the run.
- **Periodic reconciler** (`@Cron`, interval = `AGENT_RETRY_INTERVAL_MS`).
  Same call sequence. Always on. Bounded by `AGENT_RETRY_MAX_ATTEMPTS` per
  agent — counter is in-memory; on process restart, attempts reset (the work
  is idempotent so this is safe).

Both paths are idempotent via the existence check. Per-agent failures log and
continue without crashing the run.

## Security

- `NAMESPACE_API_KEY` lives in `.env`, loaded by `ConfigService`, held inside
  the `OffchainManagerClient` provider, never logged. Boot logs only `key set:
  yes/no`. Mirrors the `INFO_API_KEY` HMAC pattern.
- All endpoints under the global throttler. Per-route limits set above.
- No CORS exposure: the endpoints are server-to-server (agent → backend),
  same as `POST /voucher`.
- Input validation via class-validator DTOs (matches existing
  `RequestVoucherDto` style).
- Errors return shape-stable JSON; no SDK error messages leaked verbatim
  (wrap in `BadRequestException` / `ConflictException` with sanitized text).

## STARTER_PROMPT.md change (minimal)

**Augment** the existing Step 3 — keep the on-chain `RegisterAgent` call
(only the agent can sign it) and append a mandatory follow-up that POSTs to
the new endpoint:

```
> Step 3 — Register your agent identity (mandatory, two parts)
>
> Part A — pick a unique lowercase name (3–20 chars, [a-z0-9-]) and register
> it on-chain. Backend pays gas via your voucher.
>
>   vara-wallet --account agent call $BASKET_MARKET BasketMarket/RegisterAgent \
>     --args '["<your-agent-name>"]' \
>     --voucher
>
> Part B — claim the matching ENS subname. Optionally include profile
> fields: description, twitter, github, discord, telegram, url, avatar,
> location, eth address. Skip any.
>
>   curl -fsS -X POST $VOUCHER_BACKEND/agent/register \
>     -H 'content-type: application/json' \
>     -d '{
>       "account": "<vara-ss58>",
>       "name": "<your-agent-name>",
>       "profile": {
>         "texts": {
>           "description": "...",
>           "com.twitter": "..."
>         },
>         "ethAddress": "0x..."
>       }
>     }'
>
> 200 → <name>.polybaskets.eth claimed.
> 202 → pending finality, the reconciler will create it. Continue, do not abort.
> 409 → on-chain name mismatch or subname taken; fix and retry.
> 429 → wait `retryAfterSec` and retry. Do not abort.
>
> Edit profile later: PATCH $VOUCHER_BACKEND/agent/profile
```

The duplicate `vara-wallet ... RegisterAgent` snippets near lines 281–287 and
350 also gain a one-line "then POST /agent/register" reference, no full curl
duplication — keep the diff lean.

## Env vars (already present in .env, no new ones)

- `NAMESPACE_API_KEY` — Namespace SDK key.
- `NAMESPACE_MODE` — `mainnet` | `sepolia`.
- `AGENT_PARENT_NAME` — `polybaskets.eth`.
- `POLYBASKETS_OWNER_EVM` — owner address for all created subnames.
- `AGENT_RETRY_INTERVAL_MS`, `AGENT_RETRY_MAX_ATTEMPTS` — finality poll knobs.
- `MIGRATION_ENABLED` — one-shot bulk migration flag.

## Test plan

Unit:

- `agent-registrar.service.spec.ts` — register flow with: name available, name
  taken (same account), name taken (different account), invalid name,
  reserved name, finality lag, SDK failure after on-chain success.
- `vara-agent.reader.spec.ts` — getAgent / getAllAgents shape.
- `agent-registrar.migration.spec.ts` — idempotent on re-run.

Integration (Jest + a sepolia Namespace project + a Vara devnet):

- End-to-end `POST /agent/register` with no profile → subname appears with
  defaults.
- End-to-end with full profile → all texts and Ethereum address resolvable.
- `PATCH /agent/profile` → keys added, keys removed (null), stale-name
  rejection.
- `GET /agent/profile/:account` → returns the same payload that was written.
- Migration: pre-seed 3 agents on-chain, run with `MIGRATION_ENABLED=true`,
  verify all 3 subnames created; re-run, verify zero new creates.

Manual smoke before merge:

- One register from a real testnet wallet.
- Confirm `happy.polybaskets.eth` resolves on `app.ens.domains` (sepolia mode).
- Confirm logs do not contain the API key.

## Rollout

1. Deploy backend with `MIGRATION_ENABLED=false`. Verify health.
2. Switch a single agent to the new STARTER_PROMPT step. Verify subname.
3. Set `MIGRATION_ENABLED=true`, restart one pod, confirm migration log,
   set back to `false`.
4. Roll the new STARTER_PROMPT to all agents.

Rollback: revert the STARTER_PROMPT change (agents fall back to the old
`vara-wallet RegisterAgent` step). Backend module can stay deployed; it has no
effect when no requests arrive. Existing subnames remain valid.

## Open items deferred to implementation

- Decide between `setRecords` (single SDK call) vs. multiple per-record SDK
  calls based on the SDK's ergonomics at the time of build.
