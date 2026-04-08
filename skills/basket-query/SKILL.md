---
name: basket-query
description: Use when the agent needs to read basket state, user positions, settlement status, config, or basket count from the on-chain contracts. All queries are free (no gas, no account needed). Do not use for state-changing operations.
---

# Basket Query

All queries are read-only and free — no `--account` needed.

## Setup

```bash
# Set variables (see ../references/program-ids.md)
BASKET_MARKET="0x43b9703636ea9eda9e25398962adb6c19cba9a4a20fa6b3dd2e66a244ff6d04a"
BET_TOKEN="0x16aa2dff1365dd04733306a39205cf1bc2a730d8b8d488d0467b98cfdf2a88c1"
BET_LANE="0x501921de35cbd677c724449761b8477cf8fbb41e603deab80f68565943def59a"
_PB="${POLYBASKETS_SKILLS_DIR:-skills}"
IDL="$_PB/idl/polymarket-mirror.idl"
BET_TOKEN_IDL="$_PB/idl/bet_token_client.idl"
BET_LANE_IDL="$_PB/idl/bet_lane_client.idl"
```

## Get Your Hex Address

Sails `actor_id` args require hex format — SS58 addresses won't work:

```bash
MY_ADDR=$(vara-wallet balance | jq -r .address)
echo $MY_ADDR  # 0xe008...
```

## BasketMarket Queries

### Get basket count

```bash
vara-wallet call $BASKET_MARKET BasketMarket/GetBasketCount --args '[]' --idl $IDL
```

Returns `u64` — total baskets created. Basket IDs are 0-indexed.

### Get a basket

```bash
vara-wallet call $BASKET_MARKET BasketMarket/GetBasket --args '[0]' --idl $IDL
```

Returns `Result<Basket, BasketMarketError>`. Parse with jq:

```bash
vara-wallet call $BASKET_MARKET BasketMarket/GetBasket --args '[0]' --idl $IDL | jq '.ok'
```

Basket fields: `id`, `creator`, `name`, `description`, `items` (array of BasketItem), `created_at`, `status` (Active/SettlementPending/Settled), `asset_kind` (Vara/Bet).

### Get user positions

```bash
vara-wallet call $BASKET_MARKET BasketMarket/GetPositions \
  --args '["'$MY_ADDR'"]' --idl $IDL
```

Returns `vec Position`. Each position has: `basket_id`, `user`, `shares`, `claimed`, `index_at_creation_bps`.

To get the agent's own address:
```bash
AGENT_ADDR=$(vara-wallet wallet list | jq -r '.[0].address')
```

### Get settlement

```bash
vara-wallet call $BASKET_MARKET BasketMarket/GetSettlement --args '[0]' --idl $IDL
```

Returns `Result<Settlement, BasketMarketError>`. Key fields: `status` (Proposed/Finalized), `payout_per_share`, `challenge_deadline`, `finalized_at`, `item_resolutions`.

### Check config

```bash
vara-wallet call $BASKET_MARKET BasketMarket/GetConfig --args '[]' --idl $IDL
```

Returns `BasketMarketConfig`: `admin_role`, `settler_role`, `liveness_ms`, `vara_enabled`.

### Check VARA enabled

```bash
vara-wallet call $BASKET_MARKET BasketMarket/IsVaraEnabled --args '[]' --idl $IDL
```

Returns `bool`.

## BetToken Queries

### Check BET balance

```bash
vara-wallet call $BET_TOKEN BetToken/BalanceOf \
  --args '["'$MY_ADDR'"]' --idl $BET_TOKEN_IDL
```

### Check claim preview

```bash
vara-wallet call $BET_TOKEN BetToken/GetClaimPreview \
  --args '["'$MY_ADDR'"]' --idl $BET_TOKEN_IDL
```

Returns `ClaimPreview`: `amount`, `streak_days`, `next_claim_at`, `can_claim_now`.

### Check claim state

```bash
vara-wallet call $BET_TOKEN BetToken/GetClaimState \
  --args '["'$MY_ADDR'"]' --idl $BET_TOKEN_IDL
```

### Check token info

```bash
vara-wallet call $BET_TOKEN Metadata/Name --args '[]' --idl $BET_TOKEN_IDL
vara-wallet call $BET_TOKEN Metadata/Symbol --args '[]' --idl $BET_TOKEN_IDL
vara-wallet call $BET_TOKEN Metadata/Decimals --args '[]' --idl $BET_TOKEN_IDL
vara-wallet call $BET_TOKEN BetToken/TotalSupply --args '[]' --idl $BET_TOKEN_IDL
```

Note: `Name`, `Symbol`, `Decimals` are on the `Metadata` service, not `BetToken`.

## BetLane Queries

### Get position in BET lane

```bash
vara-wallet call $BET_LANE BetLane/GetPosition \
  --args '["0x<user_actor_id>", 0]' --idl $BET_LANE_IDL
```

Returns `Position`: `shares` (u256), `claimed`, `index_at_creation_bps`. Note: BetLane positions use `u256` shares (BET tokens), unlike BasketMarket positions which use `u128` (VARA).

### Get paginated positions

```bash
vara-wallet call $BET_LANE BetLane/GetPositions \
  --args '["0x<user_actor_id>", 0, 10]' --idl $BET_LANE_IDL
```

Args: `user`, `offset`, `limit`. Returns `Result<vec UserPositionView, BetLaneError>`.

### Check BetLane config

```bash
vara-wallet call $BET_LANE BetLane/GetConfig --args '[]' --idl $BET_LANE_IDL
```

Returns `BetLaneConfig`: `min_bet`, `max_bet`, `payouts_allowed_while_paused`.

### Check paused status

```bash
vara-wallet call $BET_LANE BetLane/IsPaused --args '[]' --idl $BET_LANE_IDL
```
