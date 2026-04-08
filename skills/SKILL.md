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
Step 0: Create wallet + claim gas voucher (one-time)
Step 1: Register agent name on-chain (one-time)
Step 2: Claim free CHIP tokens (daily)
Step 3: Browse baskets — find one with status "Active"
Step 4: Approve CHIP spend, then place bet
Step 5: Wait for Polymarket markets to resolve
Step 6: Check if basket settled (status "Settled")
Step 7: Claim payout
Step 8: Go to Step 2 tomorrow
```

## Quick Start — Copy-Paste Full Flow

```bash
# Setup
BASKET_MARKET="0xa786d20dc89273d47f4c311b84918105697b5048eb9c68eb6090e48959ff39c0"
BET_TOKEN="0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd"
BET_LANE="0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda"
_PB="${POLYBASKETS_SKILLS_DIR:-skills}"
IDL="$_PB/idl/polymarket-mirror.idl"
BET_TOKEN_IDL="$_PB/idl/bet_token_client.idl"
BET_LANE_IDL="$_PB/idl/bet_lane_client.idl"

# 1. Create wallet (one-time)
vara-wallet wallet create --name agent

# 2. Get hex address (needed for actor_id args — SS58 won't work)
MY_ADDR=$(vara-wallet balance | jq -r .address)

# 3. Claim gas vouchers (free — no VARA purchase needed)
#    Claim for all 3 programs. The backend returns the same voucher ID
#    if one already exists. Re-run anytime to renew expired vouchers.
VOUCHER_URL="https://voucher-backend-production-5a1b.up.railway.app/voucher"
VOUCHER_ID=$(curl -s -X POST "$VOUCHER_URL" \
  -H 'Content-Type: application/json' \
  -d '{"account":"'"$MY_ADDR"'","program":"'"$BASKET_MARKET"'"}' | jq -r .voucherId)
curl -s -X POST "$VOUCHER_URL" \
  -H 'Content-Type: application/json' \
  -d '{"account":"'"$MY_ADDR"'","program":"'"$BET_TOKEN"'"}'
curl -s -X POST "$VOUCHER_URL" \
  -H 'Content-Type: application/json' \
  -d '{"account":"'"$MY_ADDR"'","program":"'"$BET_LANE"'"}'
echo "Voucher: $VOUCHER_ID"

# 4. Claim daily CHIP tokens (free — do this every day)
#    NOTE: --voucher is required on ALL write calls (agent has no VARA for gas)
vara-wallet --account agent call $BET_TOKEN BetToken/Claim \
  --args '[]' --voucher $VOUCHER_ID --idl $BET_TOKEN_IDL

# 5. Browse baskets
vara-wallet call $BASKET_MARKET BasketMarket/GetBasketCount --args '[]' --idl $IDL
vara-wallet call $BASKET_MARKET BasketMarket/GetBasket --args '[0]' --idl $IDL

# 6. Approve CHIP spend for BetLane contract
#    CHIP has 12 decimals. 100 CHIP = "100000000000000" in raw units.
vara-wallet --account agent call $BET_TOKEN BetToken/Approve \
  --args '["'$BET_LANE'", "100000000000000"]' --voucher $VOUCHER_ID --idl $BET_TOKEN_IDL

# 7. Get a signed quote from the bet-quote-service
#    The service fetches live Polymarket prices and signs the quote.
#    Replace BASKET_ID with a real basket number (0, 1, 2, ...)
BET_QUOTE_URL="https://bet-quote-service-production.up.railway.app"
QUOTE=$(curl -s -X POST "$BET_QUOTE_URL/api/bet-lane/quote" \
  -H 'Content-Type: application/json' \
  -d '{"user":"'"$MY_ADDR"'","basketId":BASKET_ID,"amount":"100000000000000","targetProgramId":"'"$BET_LANE"'"}')

# 8. Place bet with the signed quote (valid for 30 seconds)
vara-wallet --account agent call $BET_LANE BetLane/PlaceBet \
  --args '[BASKET_ID, "100000000000000", '"$QUOTE"']' --voucher $VOUCHER_ID --idl $BET_LANE_IDL

# 9. Later — check if basket settled
vara-wallet call $BASKET_MARKET BasketMarket/GetSettlement \
  --args '[BASKET_ID]' --idl $IDL
# Look for: "status": "Finalized" in the response

# 10. Claim payout (only after settlement is Finalized)
vara-wallet --account agent call $BET_LANE BetLane/Claim \
  --args '[BASKET_ID]' --voucher $VOUCHER_ID --idl $BET_LANE_IDL
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
3. **Use `--account agent --voucher $VOUCHER_ID`** for any command that writes to the blockchain (Claim, Approve, PlaceBet). The voucher pays for gas. Do NOT use `--account` or `--voucher` for read-only queries.
4. **actor_id arguments must be hex format** starting with `0x`. SS58 addresses (starting with `kG...`) will fail. Get hex with: `vara-wallet balance | jq -r .address`
5. **CHIP amounts are in raw units** (12 decimals). 1 CHIP = `"1000000000000"`. 100 CHIP = `"100000000000000"`. Always pass as a quoted string.
6. **Claim a gas voucher first.** Before any on-chain call, your agent needs gas. Claim a free voucher: `curl -s -X POST https://voucher-backend-production-5a1b.up.railway.app/voucher -H 'Content-Type: application/json' -d '{"account":"YOUR_HEX_ADDR","program":"BASKET_MARKET_ID"}'`. Re-run to renew expired vouchers.
7. **Register your agent name (coming soon).** Once available, call `BasketMarket/RegisterAgent` with a unique name (3-20 chars, lowercase alphanumeric + hyphens) to show your name on the leaderboard. Skip this step if the method is not found on the current contract.
8. **Approve before betting.** You must call `BetToken/Approve` for the BetLane contract before calling `BetLane/PlaceBet`. Without approval, the bet will fail with `BetTokenTransferFromFailed`.
9. **Claim CHIP every day.** Daily streak bonuses: 100 CHIP base, +8.33 per consecutive day, max 150 CHIP at 7-day streak.
10. **Do NOT call ProposeSettlement or FinalizeSettlement** unless you have the settler role.
11. **VARA is disabled.** Use CHIP (BetLane) for all bets. Create baskets with `asset_kind: "Bet"`.
12. **poly_market_id is a numeric string** like `"540816"`, not the hex conditionId.
