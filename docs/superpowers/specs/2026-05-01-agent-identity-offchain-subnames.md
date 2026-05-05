# Agent Identity via Offchain ENS Subnames

**Date:** 2026-05-01
**Status:** Implemented on `feat/agent-registrar`. Option D shipped (gasless chain-first via voucher-backend) with the registrar inlined into the existing `gasless/` module rather than a new `agents/` module.

---

## Summary

Each PolyBaskets agent registers a `<label>.polybaskets.eth` subname through a UX-atomic flow:

1. Agent signs a SIWS-style payload with their Vara key.
2. `voucher-backend` validates the signature and submits the existing on-chain `register_agent(label)` extrinsic, paying gas on behalf of the agent (same gasless infrastructure used for vouchers today).
3. After the chain finalizes the registration event, voucher-backend creates the ENS subname via the `@thenamespace/offchain-manager` SDK.
4. The agent receives one success response. The ENS materialization is best-effort but guaranteed by a retry worker if the synchronous call fails.

The Vara contract is the **single source of truth** for the SS58 ↔ label binding. The ENS subname is a derived, eventually-consistent mirror that carries profile data and enables reverse resolution.

## Goals

- Replace today's contract-only agent identity with subname-backed identity that carries avatar, bio, and social handles at zero cost to the agent.
- Preserve on-chain provability — anyone can verify "agent X owns label Y" by reading the contract.
- Enable bidirectional resolution: `<label>` → SS58 (forward, via ENS) and SS58 → `<label>` (reverse, via offchain-manager metadata search).
- Keep the agent UX to one signed payload, one HTTP call, one success response.
- Reuse the existing voucher-backend gasless infrastructure; do not introduce a new gas-paying service.

## Non-goals

- Renaming. **Names are permanent**: once registered, the label is bound to the agent's SS58 forever. Profile fields (avatar, bio, etc.) remain mutable.
- Releasing names. There is no `DELETE /profile` endpoint in v1. An agent who wants to disappear sets a metadata flag like `status: inactive`; the binding stays.
- Per-user EVM ownership of subnames. The `owner` ENS field is the EVM wallet that owns `polybaskets.eth`, identical for every subname. App-level ownership is enforced by the registrar's signature check.
- ENSIP-19 onchain reverse resolution. Reverse runs through offchain-manager's metadata search.
- Cross-curve key derivation (SS58 → EVM). Not required.

## Architecture

```
┌─────────────┐    one signed payload      ┌──────────────────┐
│   Agent     │ ─────────────────────────▶ │ voucher-backend  │
│  (Vara key) │                            │ /agents/register │
└─────────────┘ ◀────────────── 200 ────── └──────────────────┘
                                                    │
                                                    │ 1. submit register_agent(label)
                                                    ▼
                                            ┌──────────────────┐
                                            │   Vara chain     │
                                            │ register_agent() │
                                            └──────────────────┘
                                                    │
                                                    │ 2. AgentRegistered event finalizes
                                                    ▼
                                            ┌──────────────────┐
                                            │  retry worker    │ ◀─── chain event listener
                                            │  agent_pending   │
                                            └──────────────────┘
                                                    │
                                                    │ 3. createSubname(...)
                                                    ▼
                                            ┌──────────────────┐
                                            │ offchain-manager │
                                            │   (Namespace)    │
                                            └──────────────────┘
```

- **Chain is canonical.** Names live on the contract; ENS is a derived view.
- **One signed payload** for register; one for profile update.
- **One writer** to ENS: voucher-backend. Frontend never holds the API key.
- **Retry worker** ensures ENS eventually mirrors every on-chain registration even if the synchronous call fails.

## Subname record shape

| Field | Value | Mutable? | Purpose |
|---|---|---|---|
| `parentName` | `polybaskets.eth` | no | fixed |
| `label` | matches the on-chain agent name | **no** | display handle, name on chain is canonical |
| `owner` | `POLYBASKETS_OWNER_EVM` (parent's EVM wallet, same for every subname) | no | ENS-level requirement; not used app-side |
| `addresses` | `[{ chain: ChainName.Vara, value: ss58 }]` | **no** | binds the subname to the agent's Vara key permanently |
| `metadata.varaAddress` | `ss58` | **no** | reverse-lookup key |
| `texts` | `name`, `avatar`, `description`, `com.twitter`, `url`, `keywords` | **yes** | profile |
| `metadata` (other keys) | `agentType`, `agentVersion`, `policyUrl`, `schemaVersion`, `status` | **yes** | app-controlled fields |

Constants enforced server-side (mirror today's contract rules):

- Label regex: `^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])?$`
- Length 3–20.
- Globally unique within `polybaskets.eth`. Uniqueness is enforced by the contract first; ENS uniqueness is automatic since chain registration succeeded means the label was free.

## API surface

```
POST   /api/v1/agents/register              signed   register a new agent (chain + ENS)
PATCH  /api/v1/agents/profile               signed   update mutable texts/metadata only
GET    /api/v1/agents/availability/:label   public   check label free
GET    /api/v1/agents/by-label/:label       public   forward lookup
GET    /api/v1/agents/by-address/:ss58      public   reverse lookup (single)
POST   /api/v1/agents/by-addresses          public   reverse lookup (bulk, max 100)
```

No `/rename`, no `DELETE /profile`. Names are permanent.

### Signed payload

```ts
type AgentAction = 'register' | 'update';

type SignedPayload = {
  ss58: string;                            // signer's Vara address
  action: AgentAction;
  label?: string;                          // required for register only; ignored on update
  texts?: Record<string, string>;          // mutable subset on update
  metadata?: Record<string, string>;       // mutable subset on update; varaAddress excluded
  nonce: string;                           // uuid v4, single-use
  issuedAt: number;                        // unix seconds
  expiresAt: number;                       // unix seconds, max issuedAt + 600
  audience: 'polybaskets.eth';
};

type SignedRequest = {
  payload: SignedPayload;                  // serialized verbatim, stable key order
  signature: `0x${string}`;                // sr25519 or ed25519
};
```

### Validation pipeline

In strict order; any failure returns 400/401/403:

1. **Schema** — class-validator on `SignedRequest`.
2. **Time bounds** — `now ≥ issuedAt - 30s`, `now ≤ expiresAt`, `expiresAt - issuedAt ≤ 600`.
3. **Audience** — exact match `polybaskets.eth`.
4. **Nonce single-use** — `INSERT INTO agent_nonce (nonce, expires_at) ON CONFLICT DO NOTHING`; reject if no row inserted. Pruned hourly.
5. **Signature** — canonicalize payload, `signatureVerify(canonical, signature, payload.ss58)` from `@polkadot/util-crypto`.
6. **Action checks:**
   - `register`:
     - label passes regex, not in blocklist.
     - no existing on-chain agent record for `payload.ss58` (read contract `get_agent(ss58)`).
     - label not already taken on chain (read contract `get_agent_by_label(label)` if available, or rely on the subsequent register_agent call returning `AgentNameTaken`).
   - `update`:
     - existing on-chain agent record for `payload.ss58` (chain confirms identity).
     - per-field validation: `avatar` must start with `https://` or `ipfs://`; `description` ≤ 500 chars; `com.twitter` ≤ 32 alphanumeric; `url` ≤ 200 starting with `https://`; `keywords` ≤ 200; immutable keys (`varaAddress`) rejected.
     - **signer-matches-bound-ss58** — `payload.ss58` must equal the SS58 currently bound to the agent on chain. Looked up via `get_agent(payload.ss58)` returning the agent record; reject if not found.
7. **Rate limits** — see table below. Backed by Postgres `agent_action_log`.
8. **Mutate** — see *Atomic flow* and *Profile update flow* below.

### Rate limits

| Action | Limit | Reasoning |
|---|---|---|
| Register | 1 per `ss58` (lifetime) | mirrors contract: one name per agent, permanent |
| Update profile | 10 per day | enough for legitimate edits, blocks spam |

## Atomic flow (register)

The user perceives one operation. Internally it's chain-first, then ENS:

1. Validation pipeline passes.
2. Insert `agent_pending(ss58, label, status='chain_pending', requested_at)` row.
3. Submit on-chain extrinsic `register_agent(label)` from `voucher-backend`'s funded Vara wallet (same wallet that pays for vouchers).
4. Await chain finalization. On `AgentRegistered` event matching `(ss58, label)`:
   - update row: `status='ens_pending'`.
   - call `client.createSubname({ label, parentName: 'polybaskets.eth', owner: POLYBASKETS_OWNER_EVM, addresses: [{ chain: ChainName.Vara, value: ss58 }], metadata: [{ key: 'varaAddress', value: ss58 }, ...optionalProfileMetadata], texts: optionalProfileTexts })`.
   - on success: update row `status='complete'`. Return 200 to the agent.
   - on failure: log error, leave row at `status='ens_pending'`. Return 200 to the agent (chain succeeded).
5. The retry worker (described below) picks up `ens_pending` rows and reconciles.

If chain finalization fails or times out (60s), return 502 to the agent. The pending row is marked `status='chain_failed'` and pruned after 24h.

## Profile update flow

1. Validation pipeline passes (signer-matches-bound-ss58 already enforced in step 6).
2. Compose the merge payload: existing texts/metadata from `getSingleSubname(label.polybaskets.eth)` + the requested updates, excluding immutable keys.
3. Call `client.updateSubname(fullName, { texts, metadata })`. The SDK rebuilds the request and preserves `addresses` and `owner` automatically.
4. On success: 200. On failure: 502 with retry suggested.

No chain interaction. Profile updates do not touch the contract.

## Retry worker

A `@nestjs/schedule` cron task runs every 30 seconds.

```sql
SELECT ss58, label FROM agent_pending
WHERE status = 'ens_pending'
  AND last_attempt_at < now() - interval '30 seconds'
ORDER BY requested_at ASC
LIMIT 50;
```

For each row: re-attempt `client.createSubname(...)` with the same arguments. On success: mark `complete`. On failure: increment `attempt_count`, exponential backoff capped at 1 hour. After 24h of failures, alert on Slack/Sentry; do not auto-give-up.

`createSubname` is idempotent on repeat calls with the same data — it overwrites — so retries are safe.

## Reverse resolution

```ts
const result = await client.getFilteredSubnames({
  parentName: 'polybaskets.eth',
  metadata: { varaAddress: ss58 },
  size: 1,
});
const subname = result.items[0] ?? null;
```

Single offchain-manager call. JSONB containment match. Source of truth at the SS58 ↔ label binding level remains the **chain**; offchain-manager is queried for the binding plus profile data because that's where profile lives.

For the leaderboard's bulk reverse lookup (50 agents per page), the frontend calls `POST /agents/by-addresses` with up to 100 SS58s. The registrar fans out N concurrent SDK calls and caches per-`ss58` results in an in-memory LRU (capacity 5000, 60s TTL) inside the Nest service.

## Forward resolution

```ts
const subname = await client.getSingleSubname(`${label}.polybaskets.eth`);
```

Or any standard ENS resolver (viem, ethers, etc.) — `polybaskets.eth` is a real ENS name with a Namespace-managed offchain resolver, so existing tools work.

## Frontend integration

- New `RegisterAgentDialog` and `EditAgentProfile` components hitting voucher-backend write routes. No rename UI.
- Replace `src/hooks/useAgentNames.ts` (today: polls contract `getAllAgents()` every 60s) with a hook that collects visible agent SS58s and calls `POST /agents/by-addresses` once per render, with a 30s stale-while-revalidate cache. Retain the `agent-<12hex>` deterministic fallback for unregistered agents.
- The unused `registerAgent()` wrapper in `src/basket-market-client/lib.ts` is removed.
- `AgentProfilePage` reads `texts` to render avatar, bio, twitter.

## On-chain `register_agent` — keeps its current role

- The contract method stays exactly as it is today. We do **not** deprecate it; option D depends on it as the source of truth.
- The contract's existing 7-day rename cooldown is irrelevant in our flow because the registrar route never exposes rename. If a user calls the contract directly with their own gas, they can technically rename, but that's not a supported path and won't break anything (the next time the registrar updates that user's profile, it reads the current label from chain).
- Future contract upgrade: optionally remove the rename branch entirely. Out of scope for v1.

## Migration of existing agents

One-time bulk migration at deploy:

1. Read `program.basketMarket.getAllAgents()` from the chain.
2. For each `(ss58, label, registeredAt)`:
   - Insert `agent_pending(ss58, label, status='ens_pending', requested_at=registeredAt)`.
3. The retry worker picks them up on its next tick and creates the ENS subnames in the natural batch shape.

The migration script does not require user signatures because the chain already attests to ownership. It runs once, idempotently, gated by a `MIGRATION_ENABLED=true` env var that flips off after completion.

## Configuration

New env vars in `voucher-backend`:

| Name | Purpose |
|---|---|
| `NAMESPACE_API_KEY` | API key for the offchain-manager SDK (rotated; stored in `.env` only) |
| `NAMESPACE_MODE` | `mainnet` or `sepolia` |
| `POLYBASKETS_OWNER_EVM` | EVM address that owns `polybaskets.eth`; passed as `owner` on every subname |
| `AGENT_PARENT_NAME` | `polybaskets.eth` (configurable for staging) |
| `AGENT_REGISTRAR_VARA_SEED` | seed for the Vara wallet that submits on-chain extrinsics; reuses voucher-backend's existing wallet management |
| `MIGRATION_ENABLED` | one-shot toggle for the bulk migration job |

## Implementation footprint (as shipped)

The registrar lives inside the existing `gasless/` module rather than a separate `agents/` module — smaller diff, one Nest module surface, and the signature verifier is naturally shared with future voucher-side flows.

```
voucher-backend/
└── src/
    ├── entities/
    │   ├── agent-nonce.entity.ts                # NEW
    │   ├── agent-action-log.entity.ts           # NEW
    │   └── agent-pending.entity.ts              # NEW
    ├── basket-market-client/                     # NEW — copy of frontend Sails client
    │   ├── lib.ts
    │   └── global.d.ts
    └── gasless/
        ├── gasless.module.ts                    # MODIFIED — registers new providers + AgentController
        ├── gasless.controller.ts                # unchanged
        ├── gasless.service.ts                   # unchanged
        ├── voucher.service.ts                   # unchanged
        ├── voucher.task.ts                      # unchanged
        ├── wallet-lock.ts                       # unchanged
        ├── agent.controller.ts                  # NEW — /api/v1/agents/* routes
        ├── agent.service.ts                     # NEW — register, update, reads orchestration
        ├── chain-submitter.service.ts           # NEW — register_agent extrinsic + getAllAgents
        ├── retry-worker.task.ts                 # NEW — @nestjs/schedule cron
        ├── migration.task.ts                    # NEW — one-shot bulk migration (MIGRATION_ENABLED gate)
        ├── offchain-manager.client.ts           # NEW — typed SDK wrapper
        ├── signature.verifier.ts                # NEW — sr25519/ed25519 + canonicalize
        ├── name.validator.ts                    # NEW — regex + blocklist
        ├── ratelimit.service.ts                 # NEW — Postgres sliding-window
        ├── nonce.service.ts                    # NEW — Postgres-backed single-use nonces
        └── dto/
            ├── signed-request.dto.ts            # NEW
            ├── register-agent.dto.ts            # NEW
            └── update-agent.dto.ts              # NEW
└── test/
    └── agents.e2e-spec.ts                       # NEW — manual run only
```

`GaslessModule` is updated to import the three new entities, register the new controller, and provide all new services. No new top-level module in `app.module.ts` — only the `entities: [...]` array in the existing `TypeOrmModule.forRootAsync` is extended.

Three new TypeORM entities:

- `agent_nonce(nonce PK, expires_at)` — replay protection.
- `agent_action_log(id PK, ss58, action, created_at, INDEX(ss58, action, created_at))` — sliding-window rate limits.
- `agent_pending(ss58 PK, label, status, requested_at, last_attempt_at, attempt_count, error_message)` — atomic-flow tracking and retry queue.

Note: column types ended up as `datetime` rather than `timestamptz` so sqlite in-memory tests work. Production Postgres stores them as `TIMESTAMP` (no tz tagging). Acceptable for our use case; easy to revisit if timezone-aware queries become important.

The SS58 ↔ label binding lives on chain; these tables are operational, not canonical.

## Migration plan (deploy)

1. Implement registrar in staging, wire `NAMESPACE_MODE=sepolia` and a staging parent like `polybaskets-staging.eth`.
2. Deploy and smoke-test register/update with one staging agent.
3. Run bulk migration on staging, verify all existing agents have ENS subnames.
4. Switch frontend `useAgentNames` to the new endpoint behind a feature flag.
5. Soak for one week on staging; validate reverse-lookup latency under leaderboard load.
6. Production deploy with `polybaskets.eth` and the production API key.
7. Run bulk migration in production, monitor retry worker.
8. Flip `MIGRATION_ENABLED=false`, remove the on-chain `registerAgent()` wrapper from the frontend client.

## Risks and open questions

- **ENS reconciliation lag.** If the synchronous ENS create call fails after chain finalization, the agent appears registered on chain but their ENS subname is missing for up to a retry interval. Mitigation: retry worker every 30s + alerting after 24h of failures. The frontend can read the on-chain name as a fallback during the gap.
- **Reverse-lookup latency at scale.** JSONB containment is fine at our scale today, but the leaderboard's 50-agent fan-out hits offchain-manager 50 times per page load. Mitigation: 60s in-memory LRU. Long-term: bulk-by-metadata endpoint from Namespace, or have the indexer mirror subnames.
- **API key rotation.** The current key was shared in chat; treat as compromised and rotate before mainnet. Production key must live only in `.env`.
- **Direct contract calls.** A user could in theory call `register_agent` directly on chain, bypassing the registrar. They'd pay gas, no ENS subname would be created — until the retry worker (which can also poll for orphan on-chain registrations) reconciles. Worth adding a periodic "scan chain for unmirrored agents" pass to the worker.
- **Dispute resolution.** No process today for "I lost my Vara key, please reassign my name." Out of scope for v1; manual support flow operating on the registrar as `POLYBASKETS_OWNER_EVM` can blocklist a specific label or set `metadata.status='disputed'` if needed.

## Future scope

- Indexer mirrors subnames into Postgres; frontend reverse-lookup becomes a free GraphQL query.
- Bulk reverse-lookup endpoint co-designed with Namespace.
- ENSIP-19 onchain reverse via CCIP-Read.
- Cross-app identity reuse: other Vara dapps reading `polybaskets.eth` subnames as canonical handles.
- Promote the same pattern to `vara.eth` for ecosystem-wide naming.

## References

- Notion proposal: https://app.notion.com/p/353f49dc3e26814686ead7a7f55dcd05
- Offchain Manager SDK skill: `.claude/skills/offchain-ens-subname-sdk/SKILL.md`
- SDK source: `Namespace/Devrel/namespacesdk/packages/offchain-manager/src`
- Backend source: `Namespace/Main/offchain-manager/src/subnames`
- Current on-chain registrar: `program/app/src/lib.rs:858` (`register_agent`)
- Indexer fallback ID: `indexer/src/helpers/agent-public-id.ts`
- Frontend name hook: `src/hooks/useAgentNames.ts`
- Existing voucher-backend gasless flow: `voucher-backend/src/gasless/`
