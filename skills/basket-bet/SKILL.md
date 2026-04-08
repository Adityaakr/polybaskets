---
name: basket-bet
description: Use when the agent needs to claim CHIP tokens and place a bet on an existing basket via vara-wallet. This is the primary agent action. Do not use for basket creation, querying, or claiming payouts.
---

# Basket Bet

Claim CHIP tokens and bet on a PolyBaskets basket via `vara-wallet`.

## Setup

```bash
BASKET_MARKET="0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea"
BET_TOKEN="0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd"
BET_LANE="0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda"
_PB="${POLYBASKETS_SKILLS_DIR:-skills}"
IDL="$_PB/idl/polymarket-mirror.idl"
BET_TOKEN_IDL="$_PB/idl/bet_token_client.idl"
BET_LANE_IDL="$_PB/idl/bet_lane_client.idl"
BET_QUOTE_URL="https://bet-quote-service-production.up.railway.app"
MY_ADDR=$(vara-wallet balance --account agent | jq -r .address)
VOUCHER_ID=$(vara-wallet voucher list $MY_ADDR | jq -r '.[0].id // .[0].voucherId')
```

## CHIP Lane (Primary Path)

Most baskets use `asset_kind: "Bet"` (CHIP tokens). This is the default agent workflow.

### Step 1: Claim Daily CHIP

Agents get free CHIP tokens every day. Consecutive days build a streak that increases the amount (100 CHIP base, +8.33/day streak, max 150 CHIP at 7-day cap).

```bash
# Get your hex address (required for actor_id args — SS58 won't work)
MY_ADDR=$(vara-wallet balance | jq -r .address)

# Get your voucher ID (claim one first — see Quick Start in SKILL.md)
VOUCHER_ID=$(vara-wallet voucher list $MY_ADDR | jq -r '.[0].id // .[0].voucherId')

# Check if claim is available and how much you'll get
vara-wallet call $BET_TOKEN BetToken/GetClaimPreview \
  --args '["'$MY_ADDR'"]' --idl $BET_TOKEN_IDL

# Claim daily CHIP (do this every day to build streak)
# NOTE: --voucher is required on ALL write calls (agent has no VARA for gas)
vara-wallet --account agent call $BET_TOKEN BetToken/Claim \
  --args '[]' --voucher $VOUCHER_ID --idl $BET_TOKEN_IDL
```

The response includes your `streak_days` and `total_claimed`. Higher streak = more CHIP per claim.

### Step 2: Check CHIP Balance

```bash
vara-wallet call $BET_TOKEN BetToken/BalanceOf \
  --args '["'$MY_ADDR'"]' --idl $BET_TOKEN_IDL
```

### Step 3: Pick a Basket

Browse active baskets and find one to bet on:

```bash
# How many baskets exist
vara-wallet call $BASKET_MARKET BasketMarket/GetBasketCount --args '[]' --idl $IDL

# View a specific basket (response is nested: .result.ok)
vara-wallet call $BASKET_MARKET BasketMarket/GetBasket --args '[0]' --idl $IDL
# Example response:
# {"result":{"ok":{"id":0,"creator":"0x...","name":"...","status":"Active","asset_kind":"Bet",...}}}
```

Check that `status` is `"Active"` and `asset_kind` is `"Bet"`. The basket data is at `.result.ok` in the JSON response.

**Important:** The `basket_id` for `PlaceBet` is a plain integer (e.g., `0`, `1`, `2`), not the hex program ID.

### Step 4: Approve CHIP Spend

Allow the BetLane contract to spend your CHIP:

```bash
vara-wallet --account agent call $BET_TOKEN BetToken/Approve \
  --args '["'$BET_LANE'", <amount>]' --voucher $VOUCHER_ID --idl $BET_TOKEN_IDL
```

### Step 5: Get Signed Quote + Place Bet

Bets require a signed quote from the bet-quote-service. The quote service fetches live Polymarket prices, computes the index, and signs the payload. The contract verifies the signature on-chain.

```bash
# Quote service URL (set in Setup block above)

# 5a. Request a signed quote
QUOTE=$(curl -s -X POST "$BET_QUOTE_URL/api/bet-lane/quote" \
  -H 'Content-Type: application/json' \
  -d '{
    "user": "'$MY_ADDR'",
    "basketId": <BASKET_ID>,
    "amount": "<AMOUNT_RAW>",
    "targetProgramId": "'$BET_LANE'"
  }')

echo "$QUOTE" | jq .
# Returns: { "payload": { "target_program_id": "...", "user": "...", ... }, "signature": "0x..." }

# 5b. Place bet with the signed quote
# Extract the signed_quote object from the response and pass it to PlaceBet
vara-wallet --account agent call $BET_LANE BetLane/PlaceBet \
  --args '[<BASKET_ID>, "<AMOUNT_RAW>", '"$QUOTE"']' --voucher $VOUCHER_ID --idl $BET_LANE_IDL
```

The quote is valid for 30 seconds. If it expires, request a new one. Each quote has a unique nonce and can only be used once.

Returns `u256` -- shares received.

### Complete CHIP Lane Example

```bash
# 0. Vars are set in the Setup block above. If starting fresh:
# MY_ADDR=$(vara-wallet balance --account agent | jq -r .address)
# VOUCHER_ID=$(vara-wallet voucher list $MY_ADDR | jq -r '.[0].id // .[0].voucherId')

# 1. Claim daily CHIP
vara-wallet --account agent call $BET_TOKEN BetToken/Claim \
  --args '[]' --voucher $VOUCHER_ID --idl $BET_TOKEN_IDL

# 2. Approve BetLane to spend 100 CHIP
vara-wallet --account agent call $BET_TOKEN BetToken/Approve \
  --args '["'$BET_LANE'", "100000000000000"]' --voucher $VOUCHER_ID --idl $BET_TOKEN_IDL

# 3. Get a signed quote for basket 0, 100 CHIP
QUOTE=$(curl -s -X POST "$BET_QUOTE_URL/api/bet-lane/quote" \
  -H 'Content-Type: application/json' \
  -d '{
    "user": "'$MY_ADDR'",
    "basketId": 0,
    "amount": "100000000000000",
    "targetProgramId": "'$BET_LANE'"
  }')

# 4. Place bet with the signed quote
vara-wallet --account agent call $BET_LANE BetLane/PlaceBet \
  --args '[0, "100000000000000", '"$QUOTE"']' --voucher $VOUCHER_ID --idl $BET_LANE_IDL

# 5. Verify position
vara-wallet call $BET_LANE BetLane/GetPosition \
  --args '["'$MY_ADDR'", 0]' --idl $BET_LANE_IDL
```

**Important:** CHIP has 12 decimals. 100 CHIP = `100000000000000` (100 * 10^12) in raw units.

## How the Quote Works

The agent does NOT calculate `index_at_creation_bps` manually anymore. The bet-quote-service:
1. Reads the basket from chain (validates it's active + Bet kind)
2. Fetches live Polymarket prices for each outcome
3. Computes the weighted `quoted_index_bps`
4. Signs the payload with SR25519 (includes user, basket_id, amount, deadline, nonce)
5. Returns the signed quote

The BetLane contract verifies the signature on-chain. This prevents price manipulation.

**Quote properties:**
- Valid for 30 seconds (`deadline_ms`)
- One-time use (nonce prevents replay)
- Bound to specific user, basket, and amount

See `../references/index-math.md` for payout formula: `payout = shares * (settlement_index / entry_index)`.

## VARA Lane (asset_kind: Vara)

Some baskets accept native VARA instead of CHIP. Check basket's `asset_kind`.

```bash
# Bet 100 VARA on basket 0 at index 6120
vara-wallet --account agent call $BASKET_MARKET BasketMarket/BetOnBasket \
  --args '[0, 6120]' \
  --value 100 \
  --idl $IDL
```

Returns `u128` — shares received (equal to VARA sent in minimal units).

Note: VARA lane may be disabled on some deployments. Check with:
```bash
vara-wallet call $BASKET_MARKET BasketMarket/IsVaraEnabled --args '[]' --idl $IDL
```

## After Betting

- Check your position: `../basket-query/SKILL.md`
- Wait for settlement, then claim payout: `../basket-claim/SKILL.md`
- Come back tomorrow for more CHIP: repeat Step 1

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `InvalidQuoteSignature` | Quote not signed by configured signer | Check bet-quote-service config |
| `QuoteExpired` | Quote older than 30 seconds | Request a fresh quote |
| `QuoteNonceAlreadyUsed` | Same quote submitted twice | Request a new quote for each bet |
| `QuoteTargetMismatch` | Quote was for a different BetLane | Check `targetProgramId` matches `$BET_LANE` |
| `InvalidBetAmount` | No `--value` attached (VARA lane) | Add `--value <amount>` |
| `BasketNotActive` | Basket in settlement/settled | Cannot bet on non-active baskets |
| `BasketAssetMismatch` | Wrong lane for basket | Check basket's `asset_kind` |
| `VaraDisabled` | VARA betting off | Use CHIP lane instead |
| `AmountBelowMinBet` | CHIP amount too low | Check BetLane config for min_bet |
| `AmountAboveMaxBet` | CHIP amount too high | Check BetLane config for max_bet |
| `BetTokenTransferFromFailed` | Insufficient CHIP balance or approval | Claim more tokens or increase approval |
