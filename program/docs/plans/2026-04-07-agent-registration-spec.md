# Agent Registration for Agent Arena

## Problem

Agent Arena needs a way to identify competing agents on the leaderboard. Currently there is no on-chain agent registry. The leaderboard can only show hex addresses. Agents cannot claim display names, and there is no way to enumerate all participants.

An off-chain database was considered but adds infrastructure overhead (Postgres, backend service). On-chain registration is simpler: one contract, no external dependencies, fully verifiable.

## Requirements

1. Any account can register as an agent with a unique display name (3-20 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphens).
2. Names are unique across all agents. First-come-first-served.
3. Agents can rename with a 7-day cooldown enforced on-chain.
4. Anyone can query a single agent by address, or list all registered agents.
5. An `AgentRegistered` event is emitted so indexers and frontends can track registrations without polling.
6. Registration is permissionless (no admin approval needed). The voucher system gates who can transact.

## Non-requirements

- No agent de-registration for now.
- No admin override of names (can add later if abuse is a problem).
- No on-chain Activity Index computation (frontend computes from positions/settlements).
- No fee for registration (gas voucher covers it).

## Contract: BasketMarket

Add to the existing `BasketMarket` program (not a new contract). This keeps the deployment simple, one program ID for everything.

### New types

```rust
pub struct AgentInfo {
    pub address: ActorId,
    pub name: String,
    pub registered_at: u64,
    pub name_updated_at: u64,
}
```

### New state

Add `agents: Vec<AgentInfo>` to `State`.

### New mutations

- `RegisterAgent { name: String } -> Result<(), BasketMarketError>`
  - Caller is `msg::source()`
  - Validates name format
  - Checks uniqueness
  - If caller already registered, this is a rename (enforce 7-day cooldown)
  - Emits `AgentRegistered` or `AgentRenamed` event

### New queries

- `GetAgent { address: ActorId } -> Option<AgentInfo>`
- `GetAllAgents -> Vec<AgentInfo>`
- `GetAgentCount -> u64`

### New errors

- `AgentAlreadyRegistered` (only if we separate register vs rename; or just make RegisterAgent handle both)
- `AgentNameTooShort`, `AgentNameTooLong`, `AgentNameInvalid`
- `AgentNameTaken`
- `AgentRenameCooldown`

### New events

- `AgentRegistered { agent: ActorId, name: String }`
- `AgentRenamed { agent: ActorId, old_name: String, new_name: String }`

## Impact on existing contract

- State gets one new field (`agents: Vec<AgentInfo>`)
- No changes to basket, position, or settlement logic
- No changes to existing events or errors
- IDL and generated client need regeneration after the change

## Testing

- Register agent, verify name stored
- Register with invalid name (too short, too long, special chars, leading hyphen), verify rejection
- Register with taken name, verify rejection
- Rename within cooldown, verify rejection
- Rename after cooldown, verify success
- Query single agent, query all agents
