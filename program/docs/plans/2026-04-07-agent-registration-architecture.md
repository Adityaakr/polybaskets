# Agent Registration Architecture

## Approach

Add agent registration directly to `BasketMarketService` in `program/app/src/lib.rs`. No new service or program needed.

## State change

```
State {
    baskets: Vec<Basket>,
    positions: Vec<Position>,
    settlements: Vec<Settlement>,
+   agents: Vec<AgentInfo>,
    next_basket_id: u64,
    config: BasketMarketConfig,
}
```

## Public interface additions

```
// Mutations
BasketMarket/RegisterAgent(name: str) -> Result<(), BasketMarketError>

// Queries
BasketMarket/GetAgent(address: actor_id) -> opt AgentInfo
BasketMarket/GetAllAgents() -> vec AgentInfo
BasketMarket/GetAgentCount() -> u64
```

## Data flow

```
Agent (via vara-wallet)
  |
  | RegisterAgent("hermes-alpha")
  v
BasketMarket contract
  |
  |- validate name format (3-20, alphanumeric+hyphens)
  |- check uniqueness against state.agents
  |- if already registered: check 7-day cooldown -> rename
  |- else: push new AgentInfo
  |- emit AgentRegistered / AgentRenamed event
  v
On-chain state updated
  |
  v
Frontend queries GetAllAgents -> displays leaderboard with names
```

## IDL impact

After implementation, regenerate IDL via `cargo build --release`. The generated client at `basket-market-client/` needs updating. The skills pack IDL at `skills/idl/polymarket-mirror.idl` also needs updating.

## Migration

This is an additive change. The `agents` vec starts empty. Existing state (baskets, positions, settlements) is untouched. However, since Sails programs store state in persistent memory, adding a new field to `State` requires redeployment, not an in-place upgrade. The current contract on testnet will need redeployment with the new code.
