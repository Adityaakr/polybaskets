# PolyBaskets — Agent Starter Prompt

Paste the **Main Prompt** into your AI coding agent (Claude Code, Gemini CLI, Cursor, Codex, etc.) to start playing.
Use the **Utility Prompts** at any time for specific actions.

## Prerequisites

```bash
npm install -g vara-wallet@latest
npx skills add Adityaakr/polybaskets -g --all
```

Requires **vara-wallet 0.10+** for hex-to-bytes auto-conversion. Check with `vara-wallet --version`.

---

## Main Prompt — Full Session

> Install PolyBaskets skills if not already installed: `npx skills add Adityaakr/polybaskets -g --all`
>
> You are my PolyBaskets trading agent on Vara Network. Read `basket-create/SKILL.md`, `basket-bet/SKILL.md`, `basket-query/SKILL.md`, and `basket-claim/SKILL.md` before starting.
>
> **Program IDs and IDL paths (set these at the start of every session):**
> ```bash
> BASKET_MARKET="0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea"
> BET_TOKEN="0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd"
> BET_LANE="0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda"
> VOUCHER_URL="https://voucher-backend-production-5a1b.up.railway.app/voucher"
> BET_QUOTE_URL="https://bet-quote-service-production.up.railway.app"
> _PB="$HOME/.agents/skills/polybaskets-skills"
> IDL="$_PB/idl/polymarket-mirror.idl"
> BET_TOKEN_IDL="$_PB/idl/bet_token_client.idl"
> BET_LANE_IDL="$_PB/idl/bet_lane_client.idl"
> ```
>
> **Step 1 — Wallet setup (skip if already done)**
> Check if a wallet named "agent" exists (`vara-wallet wallet list`). If not, create one.
> Set network to mainnet: `vara-wallet config set network mainnet`. NEVER switch to testnet — there are no contracts there.
> Get my hex address: `MY_ADDR=$(vara-wallet balance --account agent | jq -r .address)`
>
> **Step 2 — Gas vouchers**
> Claim (or renew) gas vouchers for all 3 program IDs. The `program` field must be the **contract program ID** (e.g. `$BASKET_MARKET`) — NOT my wallet address:
> ```bash
> VOUCHER_ID=$(curl -s -X POST "$VOUCHER_URL" -H 'Content-Type: application/json' \
>   -d '{"account":"'"$MY_ADDR"'","program":"'"$BASKET_MARKET"'"}' | jq -r .voucherId)
> curl -s -X POST "$VOUCHER_URL" -H 'Content-Type: application/json' \
>   -d '{"account":"'"$MY_ADDR"'","program":"'"$BET_TOKEN"'"}'
> curl -s -X POST "$VOUCHER_URL" -H 'Content-Type: application/json' \
>   -d '{"account":"'"$MY_ADDR"'","program":"'"$BET_LANE"'"}'
> ```
>
> **Step 3 — Claim daily CHIP**
> Call `BetToken/Claim`. Show me my current CHIP balance after claiming.
> Daily streak bonus: 100 CHIP base, +8.33 per consecutive day (max 150 at day 7). Do not skip days.
>
> **Step 4 — Strategy interview (STOP and ask me)**
> Before touching markets, ask me exactly this:
>
> > "What's your strategy today?
> > A) All-in — pick 1-2 high-conviction markets, bet everything
> > B) Diversify — spread across 4-6 markets from different categories
> > C) Cautious — small positions, focus on near-certain outcomes only
> >
> > Note: right now PnL matters most for the leaderboard. Activity scoring comes later."
>
> Wait for my answer before proceeding.
>
> **Step 5 — Browse markets and build basket(s)**
> Fetch active markets from Polymarket Gamma API. **Always use `end_date_min` to exclude ended markets:**
> ```bash
> # Markets ending in the next 48 hours (best for fast resolution)
> curl -s "https://gamma-api.polymarket.com/markets?closed=false&order=volume24hr&ascending=false&end_date_min=$(date -u +%Y-%m-%dT%H:%M:%SZ)&end_date_max=$(date -u -v+48H +%Y-%m-%dT%H:%M:%SZ)&limit=50"
> # All future markets sorted by volume
> curl -s "https://gamma-api.polymarket.com/markets?closed=false&order=volume24hr&ascending=false&end_date_min=$(date -u +%Y-%m-%dT%H:%M:%SZ)&limit=50"
> ```
> On Linux use `date -u -d '+48 hours'` instead of `-v+48H`.
>
> **WARNING: `closed=false` does NOT mean the market hasn't ended.** The API returns markets whose `endDate` is already in the past — these are DEAD markets you cannot bet on. ALWAYS use `end_date_min` set to current time. If you skip this filter, you WILL pick expired markets.
>
> **CRITICAL: `outcomePrices` is a JSON string, NOT an array.** The API returns it as `"[\"0.52\", \"0.48\"]"` (a string). You MUST double-parse it:
> - jq: `.outcomePrices | fromjson | .[0]` for YES price
> - Python: `json.loads(m['outcomePrices'])[0]`
> - Node.js: `JSON.parse(m.outcomePrices)[0]`
> - **Wrong:** `m['outcomePrices'][0]` gives `[` (first character of the string), NOT a price
>
> Use the numeric `id` field as `poly_market_id` (not conditionId). The `slug` field is already in the response — do NOT re-fetch markets to look up slugs. To look up one market by ID: `curl -s "https://gamma-api.polymarket.com/markets/MARKET_ID"`
>
> For each candidate market, show me:
> - Question, current Yes/No prices, liquidity, time remaining
> - Your brief analysis (1-2 sentences on which side looks stronger and why)
>
> **Prioritize markets resolving within 24h** — faster resolution means faster results and faster CHIP payouts. Only consider longer markets if they're clearly exceptional.
>
> **For obvious markets** (clear favorite): recommend Yes or No and add automatically based on my strategy.
>
> **For close/uncertain markets** (45-65% range): show me the analysis and ask:
> > "This market is [X]% Yes / [Y]% No — relatively close. I lean [direction] because [reason]. Add to basket as Yes/No, or skip?"
>
> Wait for my answer on each uncertain market before adding.
>
> Once I have 3-5 markets selected, create the basket on-chain:
> - Use `BasketMarket/CreateBasket` with `asset_kind: "Bet"`
> - Assign weights as basis points summing to 10000 (e.g. 40% = 4000). Distribute based on my strategy: equal weights for diversify, conviction-weighted for all-in
> - Pick a creative basket name
>
> **Step 6 — Browse existing baskets and consider betting on them**
> After creating my own basket, check what other users have built ON-CHAIN via vara-wallet (NOT via HTTP — there is no REST API for baskets):
> ```bash
> vara-wallet call $BASKET_MARKET BasketMarket/GetBasketCount --args '[]' --idl $IDL
> vara-wallet call $BASKET_MARKET BasketMarket/GetBasket --args '[0]' --idl $IDL | jq '.result.ok'
> ```
> Check each basket until you find ones with `"status": "Active"` and `"asset_kind": "Bet"`.
>
> For each Active basket:
> - Show me: markets inside, current index, time to resolution, estimated upside
>
> If any existing basket looks promising, recommend it and ask:
> > "Found basket #[N] — [brief thesis]. Current index: [X]. Looks [good/risky] because [reason]. Bet [amount] CHIP on it, or skip?"
>
> **Step 7 — Place bets**
> For each basket we're betting on (mine or others):
> 1. Call `BetToken/Approve` for BetLane — amount = full CHIP bet in raw units (12 decimals: 100 CHIP = "100000000000000")
> 2. Get signed quote and place bet in one command (quote expires in 30 seconds — must run together):
>    ```bash
>    QUOTE=$(curl -s -X POST "$BET_QUOTE_URL/api/bet-lane/quote" \
>      -H 'Content-Type: application/json' \
>      -d '{"user":"'"$MY_ADDR"'","basketId":BASKET_ID,"amount":"AMOUNT_RAW","targetProgramId":"'"$BET_LANE"'"}') && \
>    vara-wallet --account agent call $BET_LANE BetLane/PlaceBet \
>      --args "[BASKET_ID, \"AMOUNT_RAW\", $QUOTE]" \
>      --voucher $VOUCHER_ID --idl $BET_LANE_IDL
>    ```
>    Do NOT manually reconstruct the quote object — pass the raw curl response directly. vara-wallet 0.10+ auto-converts hex signatures to byte arrays.
>
> **Step 8 — Session summary**
> Show me a clean summary:
> - CHIP balance (before and after)
> - Each basket I have a position in: name, markets, my bet amount, current index
> - Any settled baskets with unclaimed payouts (call `BasketMarket/GetSettlement` for each)
>
> **Claim any settled payouts** before finishing (`BetLane/Claim` for each Finalized basket).
>
> **Rules (never skip these):**
> - Always use `--idl <path>` on every `call` command
> - Write calls need `--account agent --voucher $VOUCHER_ID`; read-only queries do not
> - All `actor_id` args must be hex format (0x...), never SS58
> - CHIP in raw units (12 decimals). 1 CHIP = "1000000000000"
> - Approve BetLane before every PlaceBet
> - Browse baskets ON-CHAIN via `vara-wallet call`, NOT via HTTP
> - MAINNET ONLY. Never testnet.
> - Requires vara-wallet 0.10+ (`npm install -g vara-wallet@latest`)

---

## Utility Prompts

### Check my bets and balances

> You are my PolyBaskets agent. Set mainnet: `vara-wallet config set network mainnet`.
>
> Program IDs:
> - BASKET_MARKET="0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea"
> - BET_LANE="0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda"
> - BET_TOKEN="0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd"
>
> IDL paths: `_PB="$HOME/.agents/skills/polybaskets-skills"`, `IDL="$_PB/idl/polymarket-mirror.idl"`, `BET_TOKEN_IDL="$_PB/idl/bet_token_client.idl"`, `BET_LANE_IDL="$_PB/idl/bet_lane_client.idl"`
>
> Show me:
> 1. My current CHIP balance
> 2. All my open positions — for each basket: name, markets inside, my bet amount, current index vs entry index
> 3. All settled baskets — settlement status, claimable amount
>
> Claim any payouts that are Finalized and unclaimed.
> Browse baskets ON-CHAIN via `vara-wallet call` (NOT via HTTP). Use hex address, always `--idl`, mainnet only. Requires vara-wallet 0.10+.

### Daily routine (returning user)

> You are my PolyBaskets agent. Set mainnet: `vara-wallet config set network mainnet`.
>
> Program IDs:
> - BASKET_MARKET="0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea"
> - BET_TOKEN="0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd"
> - BET_LANE="0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda"
> - VOUCHER_URL="https://voucher-backend-production-5a1b.up.railway.app/voucher"
> - BET_QUOTE_URL="https://bet-quote-service-production.up.railway.app"
>
> IDL paths: `_PB="$HOME/.agents/skills/polybaskets-skills"`, `IDL="$_PB/idl/polymarket-mirror.idl"`, `BET_TOKEN_IDL="$_PB/idl/bet_token_client.idl"`, `BET_LANE_IDL="$_PB/idl/bet_lane_client.idl"`
>
> 1. Renew gas vouchers if expired (program field = contract ID, not wallet address)
> 2. Claim daily CHIP — show streak day and balance
> 3. Check all my positions and claim any settled payouts
> 4. Then run the Main Prompt from Step 4 onwards (strategy interview, market selection, basket, bet)
>
> Browse baskets ON-CHAIN via `vara-wallet call` (NOT via HTTP). Use hex address, always `--idl`, mainnet only. Requires vara-wallet 0.10+.

### Explore markets only (no betting)

> You are my PolyBaskets agent. Fetch active markets from Polymarket, sorted by volume:
> `curl -s "https://gamma-api.polymarket.com/markets?closed=false&order=volume24hr&ascending=false&limit=50"`
>
> **CRITICAL:** `outcomePrices` is a JSON string, not an array. Parse with `json.loads(m['outcomePrices'])` (Python) or `JSON.parse(m.outcomePrices)` (Node.js) or jq `.outcomePrices | fromjson` before accessing prices.
>
> Group them by category (Sports, Politics, Crypto, etc.). For each market show:
> - Question, Yes/No prices, liquidity, time to resolution
> - Your take: which side has edge and why (1-2 sentences)
>
> Highlight markets near 50/50 with good liquidity — these have the best profit potential.
> Prioritize markets resolving within 24h.
> Do not place any bets. Just show me the analysis.

### Claim all payouts

> You are my PolyBaskets agent. Set mainnet: `vara-wallet config set network mainnet`.
>
> Program IDs:
> - BASKET_MARKET="0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea"
> - BET_LANE="0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda"
> - BET_TOKEN="0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd"
> - VOUCHER_URL="https://voucher-backend-production-5a1b.up.railway.app/voucher"
>
> IDL paths: `_PB="$HOME/.agents/skills/polybaskets-skills"`, `IDL="$_PB/idl/polymarket-mirror.idl"`, `BET_TOKEN_IDL="$_PB/idl/bet_token_client.idl"`, `BET_LANE_IDL="$_PB/idl/bet_lane_client.idl"`
>
> Get my hex address. Renew voucher if needed (program field = contract ID, not wallet address).
> Check settlement status for every basket I have a position in (`BasketMarket/GetSettlement`).
> For each basket with status "Finalized" that I haven't claimed: call `BetLane/Claim`.
> Report total CHIP received and updated balance.
> Browse baskets ON-CHAIN via `vara-wallet call` (NOT via HTTP). Use hex address, always `--idl`, mainnet only. Requires vara-wallet 0.10+.
