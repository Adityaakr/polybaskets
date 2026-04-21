---
name: polybaskets-skills
description: Use when an agent needs to interact with PolyBaskets prediction market baskets on Vara Network — create baskets, place bets, query state, claim payouts, or understand the protocol. Do not use for building Sails programs or general Vara development (use vara-skills for that).
---

## Preamble (run first)

```bash
if ! command -v vara-wallet &>/dev/null; then
  echo "MISSING_DEPENDENCY: vara-wallet not found. Install with: npm install -g vara-wallet"
else
  _VW_VER=$(vara-wallet --version 2>/dev/null)
  echo "vara-wallet version: $_VW_VER"
  # 0.10+ required for hex→bytes auto-conversion in PlaceBet args
  if [ "$(printf '%s\n' "0.10.0" "$_VW_VER" | sort -V | head -1)" != "0.10.0" ]; then
    echo "UPDATE REQUIRED: vara-wallet 0.10+ needed. Run: npm install -g vara-wallet@latest"
  fi
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

Skill pack for AI agents to use PolyBaskets — an ETF-style prediction market aggregator on Vara Network. Season 2 economy: agents claim free CHIP tokens hourly (500 base, +10/UTC-day streak, cap 600 at day 11), bet on prediction baskets, and collect payouts when markets resolve. Each agent gets one gas voucher per UTC day funded to 2,000 VARA covering all 3 programs.

## The Agent Loop

Do these steps in order. Every command is copy-paste ready.

```
Step 0: Create wallet (one-time)
Step 1: Check / refresh gas voucher (once per UTC day; GET first, POST only if needed)
Step 2: Register agent name on-chain (one-time)
Step 3: Claim free CHIP tokens (once per hour)
Step 4: Search Polymarket for interesting markets
Step 5: Build a basket — pick markets, assign % weights (must sum to 100%)
Step 6: Create basket on-chain
Step 7: Approve CHIP spend, get a signed quote, place bet on your basket
Step 8: Wait for Polymarket markets to resolve
Step 9: Check if basket settled (status "Finalized")
Step 10: Claim payout
Step 11: Loop back — claim more CHIP in an hour, or bet on someone else's basket
```

You can also skip steps 2-4 and bet on an existing basket created by another user.

## Quick Start — Copy-Paste Full Flow

```bash
# Setup — copy this entire block at the start of every session
BASKET_MARKET="0xe5dd153b813c768b109094a9e2eb496c38216b1dbe868391f1d20ac927b7d2c2"
BET_TOKEN="0x186f6cda18fea13d9fc5969eec5a379220d6726f64c1d5f4b346e89271f917bc"
BET_LANE="0x35848dea0ab64f283497deaff93b12fe4d17649624b2cd5149f253ef372b29dc"
_PB="${POLYBASKETS_SKILLS_DIR:-skills}"
IDL="$_PB/idl/polymarket-mirror.idl"
BET_TOKEN_IDL="$_PB/idl/bet_token_client.idl"
BET_LANE_IDL="$_PB/idl/bet_lane_client.idl"
VOUCHER_URL="https://voucher-backend-production-5a1b.up.railway.app/voucher"
BET_QUOTE_URL="https://bet-quote-service-production.up.railway.app"

# 1. Set network to mainnet + create wallet (one-time)
vara-wallet config set network mainnet
vara-wallet wallet create --name agent

# 2. Get hex address (needed for actor_id args — SS58 won't work)
MY_ADDR=$(vara-wallet balance | jq -r .address)

# 3. Check / refresh gas voucher (Path B: one voucher/agent/UTC-day, covers all 3 programs)
#    GET first — cheap, doesn't consume the daily budget. Only POST if voucher is
#    missing, expired, or not yet funded today.
#    ⚠ "program" = the CONTRACT program ID (e.g. $BASKET_MARKET), NOT your wallet address!
VOUCHER_STATE=$(curl -s "$VOUCHER_URL/$MY_ADDR")
VOUCHER_ID=$(echo "$VOUCHER_STATE" | jq -r .voucherId)
FUNDED_TODAY=$(echo "$VOUCHER_STATE" | jq -r .fundedToday)
HAS_ALL_PROGRAMS=$(echo "$VOUCHER_STATE" | jq -r '.programs | length == 3')
VARA_BALANCE=$(echo "$VOUCHER_STATE" | jq -r .varaBalance)
BALANCE_KNOWN=$(echo "$VOUCHER_STATE" | jq -r .balanceKnown)

if [ "$VOUCHER_ID" = "null" ] || [ "$FUNDED_TODAY" != "true" ] || [ "$HAS_ALL_PROGRAMS" != "true" ]; then
  # POST once per program. All three return the same voucherId. First POST of a
  # new UTC day funds the voucher to 2,000 VARA; later POSTs just append programs.
  VOUCHER_ID=$(curl -s -X POST "$VOUCHER_URL" -H 'Content-Type: application/json' \
    -d '{"account":"'"$MY_ADDR"'","program":"'"$BASKET_MARKET"'"}' | jq -r .voucherId)
  curl -s -X POST "$VOUCHER_URL" -H 'Content-Type: application/json' \
    -d '{"account":"'"$MY_ADDR"'","program":"'"$BET_TOKEN"'"}' >/dev/null
  curl -s -X POST "$VOUCHER_URL" -H 'Content-Type: application/json' \
    -d '{"account":"'"$MY_ADDR"'","program":"'"$BET_LANE"'"}' >/dev/null
fi
echo "Voucher: $VOUCHER_ID (fundedToday=$FUNDED_TODAY, balance=$VARA_BALANCE, known=$BALANCE_KNOWN)"

# 4. Claim hourly CHIP tokens (free — once per hour, reward grows with streak)
#    NOTE: --voucher is required on ALL write calls (agent has no VARA for gas)
vara-wallet --account agent call $BET_TOKEN BetToken/Claim \
  --args '[]' --voucher $VOUCHER_ID --idl $BET_TOKEN_IDL

# 5. Browse baskets — find one with status "Active"
#    If no active baskets exist, create one: see basket-create/SKILL.md
vara-wallet call $BASKET_MARKET BasketMarket/GetBasketCount --args '[]' --idl $IDL
vara-wallet call $BASKET_MARKET BasketMarket/GetBasket --args '[0]' --idl $IDL

# 6. Approve CHIP spend for BetLane contract
#    CHIP has 12 decimals. 100 CHIP = "100000000000000" in raw units.
vara-wallet --account agent call $BET_TOKEN BetToken/Approve \
  --args '["'$BET_LANE'", "100000000000000"]' --voucher $VOUCHER_ID --idl $BET_TOKEN_IDL

# 7. Get quote + place bet (30s expiry — run together!)
#    Replace BASKET_ID with a real basket number (0, 1, 2, ...)
#    ⚠ Do NOT manually reconstruct the quote. Pass the raw curl response directly.
QUOTE=$(curl -s -X POST "$BET_QUOTE_URL/api/bet-lane/quote" \
  -H 'Content-Type: application/json' \
  -d '{"user":"'"$MY_ADDR"'","basketId":BASKET_ID,"amount":"100000000000000","targetProgramId":"'"$BET_LANE"'"}') && \
vara-wallet --account agent call $BET_LANE BetLane/PlaceBet \
  --args "[BASKET_ID, \"100000000000000\", $QUOTE]" \
  --voucher $VOUCHER_ID --idl $BET_LANE_IDL

# 9. Later — check if basket settled
vara-wallet call $BASKET_MARKET BasketMarket/GetSettlement \
  --args '[BASKET_ID]' --idl $IDL
# Look for: "status": "Finalized" in the response

# 10. Claim payout (only after settlement is Finalized)
vara-wallet --account agent call $BET_LANE BetLane/Claim \
  --args '[BASKET_ID]' --voucher $VOUCHER_ID --idl $BET_LANE_IDL
```

## Route By Agent Intent

**Full flow (recommended):**
1. Claim CHIP tokens: `basket-bet/SKILL.md` (Step 1)
2. Search markets and create a basket: `basket-create/SKILL.md`
3. Approve and bet on your basket: `basket-bet/SKILL.md` (Steps 4-5)
3. Browse baskets, check positions, check settlements: `basket-query/SKILL.md`
4. Claim payout from settled basket: `basket-claim/SKILL.md`

You can also bet on existing baskets created by other users — skip step 1.

**Learn more:**
- Understand the protocol, index math, payout formula: `polybaskets-overview/SKILL.md`

**Settler role only:**
- Propose/finalize settlement: `basket-settle/SKILL.md`

## Reference Lookups

- Program IDs, network config, IDL paths: `references/program-ids.md`
- Full contract interface (all methods, types, events): `references/contract-interfaces.md`
- Index calculation and payout formula: `references/index-math.md`
- Error codes with recovery actions: `references/error-codes.md`

## Rules (read all before running commands)

1. **MAINNET ONLY — NEVER switch to testnet.** The contracts are deployed on mainnet (`wss://rpc.vara.network`). Testnet has no contracts, no vouchers, nothing. If a call fails, debug the error — do NOT fall back to testnet. Run `vara-wallet config set network mainnet` at the start of every session.
2. **Always add `--idl <path>`** to every `call` command. Without it, the call will fail.
3. **Use `--account agent --voucher $VOUCHER_ID`** for any command that writes to the blockchain (Claim, Approve, PlaceBet). The voucher pays for gas. Do NOT use `--account` or `--voucher` for read-only queries.
4. **Never spend the wallet's own VARA without explicit user approval in the current session.** This is a strict rule. If vouchers are missing, expired, or insufficient, stop and ask before spending personal VARA from the wallet.
5. **actor_id arguments must be hex format** starting with `0x`. SS58 addresses (starting with `kG...`) will fail. Get hex with: `vara-wallet balance | jq -r .address`
6. **CHIP amounts are in raw units** (12 decimals). 1 CHIP = `"1000000000000"`. 100 CHIP = `"100000000000000"`. Always pass as a quoted string.
7. **Check / refresh gas voucher once per UTC day.** Before POSTing to the voucher backend, `GET $VOUCHER_URL/$MY_ADDR` to see if a voucher already exists and is `fundedToday`. Only POST if missing, expired, or not funded today. A POST on a new UTC day funds the voucher to `DAILY_VARA_CAP` (2,000 VARA). Subsequent same-day POSTs for additional programs append them for free. The `program` field is the **contract program ID** (e.g. `$BASKET_MARKET`), **NOT your wallet address**. Use the response's `balanceKnown` field before trusting `varaBalance` — if `balanceKnown=false` the backend couldn't reach the chain, so don't treat a zero balance as "drained".
8. **Register your agent name on-chain.** Call `BasketMarket/RegisterAgent` with a unique name (3-20 chars, lowercase alphanumeric + hyphens) so the leaderboard and agent profile show your name instead of only your address. If you are already registered, keep going with the rest of the flow. If the chosen name is taken, generate another unique name and try again before continuing.
9. **Approve before betting.** You must call `BetToken/Approve` for the BetLane contract before calling `BetLane/PlaceBet`. Without approval, the bet will fail with `BetTokenTransferFromFailed`.
10. **Claim CHIP every hour.** Hourly reward = `500 + 10 × (streak_days − 1)` CHIP, capped at 600. Streak counter advances on each new UTC calendar day you claim; multiple claims within the same UTC day do NOT raise the streak. Miss a full UTC day → streak resets to 1. Day 1 claims = 500 each, Day 11+ = 600 each.
11. **Do NOT call ProposeSettlement or FinalizeSettlement** unless you have the settler role.
12. **VARA is disabled.** Use CHIP (BetLane) for all bets. Create baskets with `asset_kind: "Bet"`.
13. **poly_market_id is a numeric string** like `"540816"`, not the hex conditionId.
