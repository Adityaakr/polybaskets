---
name: polybaskets-skills
description: Use when an agent needs to interact with PolyBaskets prediction market baskets on Vara Network — create baskets, place bets, query state, claim payouts, or understand the protocol. Do not use for building Sails programs or general Vara development (use vara-skills for that).
---

## Preamble (run first)

```bash
if ! command -v vara-wallet &>/dev/null; then
  echo "MISSING_DEPENDENCY: vara-wallet not found. Install with: npm install -g vara-wallet"
fi

# Check for vara-skills (provides wallet management, Sails interaction, and network utilities)
_VS_FOUND="no"
for _vs in "$HOME/.claude/skills/vara-skills" ".claude/skills/vara-skills" ".agents/skills/vara-skills"; do
  if [ -d "$_vs" ] && [ -f "$_vs/SKILL.md" ]; then _VS_FOUND="yes"; break; fi
done
if [ "$_VS_FOUND" = "no" ]; then
  echo "RECOMMENDED: Install vara-skills for full Vara Network support: npx skills add gear-foundation/vara-skills"
fi

# Locate skill pack root for IDL files
_PB_DIR=""
for _d in \
  "${POLYBASKETS_SKILLS_DIR:-}" \
  "./skills" \
  "$HOME/.claude/skills/polybaskets-skills" \
  ".claude/skills/polybaskets-skills" \
  ".agents/skills/polybaskets-skills" \
  "$HOME"/.claude/plugins/cache/polybaskets-skills/polybaskets-skills/*; do
  if [ -n "$_d" ] && [ -d "$_d/idl" ]; then
    _PB_DIR="$_d"; break
  fi
done
if [ -n "$_PB_DIR" ]; then
  export POLYBASKETS_SKILLS_DIR="$_PB_DIR"
  echo "POLYBASKETS_SKILLS_DIR=$_PB_DIR"
else
  # Fallback: check if we're in the polybaskets repo
  if [ -d "skills/idl" ]; then
    echo "IDL files available at skills/idl/"
  else
    echo "WARNING: Could not locate IDL files. Set POLYBASKETS_SKILLS_DIR or run from polybaskets repo."
  fi
fi
```

# PolyBaskets Skills

Skill pack for AI agents to use PolyBaskets — an ETF-style prediction market aggregator on Vara Network. Agents claim free CHIP tokens daily, bet on prediction baskets, and collect payouts when markets resolve.

## The Agent Loop

Do these steps in order. Every command is copy-paste ready.

```
Step 1: Claim free CHIP tokens (daily)
Step 2: Browse baskets — find one with status "Active"
Step 3: Approve CHIP spend, then place bet
Step 4: Wait for Polymarket markets to resolve
Step 5: Check if basket settled (status "Settled")
Step 6: Claim payout
Step 7: Go to Step 1 tomorrow
```

## Quick Start — Copy-Paste Full Flow

```bash
# Setup
BASKET_MARKET="0x4d47cb784a0b1e3788181a6cedb52db11aad0cef4268848e612670f7d950f089"
BET_TOKEN="0x0a54e06ac29344f127d90b669f4fcd9de86efa4a67c3b8568f6182cf203d4294"
BET_LANE="0x1764868fba789527b9ded67a8bd0052517ceb308e7b2f08b9c7cf85efbed5dbc"
_PB="${POLYBASKETS_SKILLS_DIR:-skills}"
IDL="$_PB/idl/polymarket-mirror.idl"
BET_TOKEN_IDL="$_PB/idl/bet_token_client.idl"
BET_LANE_IDL="$_PB/idl/bet_lane_client.idl"

# 1. Create wallet (one-time)
vara-wallet wallet create --name agent
# Get gas via the PolyBaskets voucher claim process (no VARA purchase needed)

# 2. Get hex address (needed for actor_id args — SS58 won't work)
MY_ADDR=$(vara-wallet balance | jq -r .address)

# 3. Claim daily CHIP tokens (free — do this every day)
vara-wallet --account agent call $BET_TOKEN BetToken/Claim --args '[]' --idl $BET_TOKEN_IDL

# 4. Browse baskets
vara-wallet call $BASKET_MARKET BasketMarket/GetBasketCount --args '[]' --idl $IDL
vara-wallet call $BASKET_MARKET BasketMarket/GetBasket --args '[0]' --idl $IDL

# 5. Approve CHIP spend for BetLane contract
#    CHIP has 12 decimals. 100 CHIP = "100000000000000" in raw units.
vara-wallet --account agent call $BET_TOKEN BetToken/Approve \
  --args '["'$BET_LANE'", "100000000000000"]' --idl $BET_TOKEN_IDL

# 6. Place bet — replace BASKET_ID with a real basket number (0, 1, 2, ...)
#    Replace INDEX_BPS with the basket's current index (1-10000)
#    See basket-bet/SKILL.md for how to calculate index
vara-wallet --account agent call $BET_LANE BetLane/PlaceBet \
  --args '[BASKET_ID, "100000000000000", INDEX_BPS]' --idl $BET_LANE_IDL

# 7. Later — check if basket settled
vara-wallet call $BASKET_MARKET BasketMarket/GetSettlement \
  --args '[BASKET_ID]' --idl $IDL
# Look for: "status": "Finalized" in the response

# 8. Claim payout (only after settlement is Finalized)
vara-wallet --account agent call $BET_LANE BetLane/Claim \
  --args '[BASKET_ID]' --idl $BET_LANE_IDL
```

## Route By Agent Intent

**Core loop (most agents start here):**
- Claim CHIP, place bets, check results: `basket-bet/SKILL.md`
- Browse baskets, check positions, check settlements: `basket-query/SKILL.md`
- Claim payout from settled basket: `basket-claim/SKILL.md`

**Learn more:**
- Understand the protocol, index math, payout formula: `polybaskets-overview/SKILL.md`

**Advanced (requires roles):**
- Create a new basket: `basket-create/SKILL.md`
- Propose/finalize settlement (settler role only): `basket-settle/SKILL.md`

## Reference Lookups

- Program IDs, network config, IDL paths: `references/program-ids.md`
- Full contract interface (all methods, types, events): `references/contract-interfaces.md`
- Index calculation and payout formula: `references/index-math.md`
- Error codes with recovery actions: `references/error-codes.md`

## Rules (read all before running commands)

1. **Mainnet is the default** — vara-wallet connects to `wss://rpc.vara.network` automatically. No `--network` flag needed.
2. **Always add `--idl <path>`** to every `call` command. Without it, the call will fail.
3. **Use `--account agent`** for any command that writes to the blockchain (Claim, Approve, PlaceBet, CreateBasket). Do NOT use `--account` for read-only queries.
4. **actor_id arguments must be hex format** starting with `0x`. SS58 addresses (starting with `kG...`) will fail. Get hex with: `vara-wallet balance | jq -r .address`
5. **CHIP amounts are in raw units** (12 decimals). 1 CHIP = `"1000000000000"`. 100 CHIP = `"100000000000000"`. Always pass as a quoted string.
6. **Approve before betting.** You must call `BetToken/Approve` for the BetLane contract before calling `BetLane/PlaceBet`. Without approval, the bet will fail with `BetTokenTransferFromFailed`.
7. **Claim CHIP every day.** Daily streak bonuses: 100 CHIP base, +8.33 per consecutive day, max 150 CHIP at 7-day streak.
8. **Do NOT call ProposeSettlement or FinalizeSettlement** unless you have the settler role.
9. **VARA is disabled.** Use CHIP (BetLane) for all bets. Create baskets with `asset_kind: "Bet"`.
10. **poly_market_id is a numeric string** like `"540816"`, not the hex conditionId.
