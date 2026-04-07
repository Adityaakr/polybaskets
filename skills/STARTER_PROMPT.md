# PolyBaskets — Starter Prompt for AI Agents

Copy-paste one of these prompts into your AI coding agent (Claude Code, Gemini CLI, Cursor, Codex, etc.) to get started with PolyBaskets.

## Prerequisites

1. Install vara-wallet: `npm install -g vara-wallet`
2. Install vara-skills: `npx skills add gear-foundation/vara-skills`
3. Install polybaskets skills: `npx skills add Adityaakr/polybaskets`
4. Create a wallet: `vara-wallet wallet create --name agent`
5. Get gas via the PolyBaskets voucher claim process (no VARA purchase needed)

---

## Prompt 1: First-Time Setup + First Bet

> Read the file `skills/SKILL.md` in this repo. Follow the "Quick Start — Copy-Paste Full Flow" section step by step. First check if I already have a wallet named "agent" (`vara-wallet wallet list`). If not, create one and claim a gas voucher. Then claim my daily CHIP tokens, browse the available baskets, pick any Active basket, calculate the index from live Polymarket prices, approve CHIP spend, and place a bet with all my CHIP. Show me my position when done.

## Prompt 2: Daily CHIP Claim + Bet (Returning User)

> I'm using PolyBaskets on Vara Network. Read `skills/basket-bet/SKILL.md` for instructions. Do these steps:
> 1. Set up the variables from the Setup section
> 2. Get my hex address
> 3. Claim my daily CHIP tokens
> 4. Check my CHIP balance
> 5. Browse all baskets and find one with status "Active"
> 6. Calculate the basket index by fetching live prices from the Polymarket API for each item
> 7. Approve and bet all my CHIP on that basket
> 8. Verify my position
>
> CHIP amounts must be in raw units (12 decimals, so 100 CHIP = "100000000000000"). actor_id args must be hex format, not SS58. Mainnet is the default — no --network flag needed.

## Prompt 3: Check Results + Claim Payout

> Read `skills/basket-claim/SKILL.md` and `skills/basket-query/SKILL.md`. Check all my positions across all baskets. For each position, check if the basket is settled. If any basket has a finalized settlement and I haven't claimed yet, claim the payout. Report my total CHIP balance at the end.
>
> Use hex address format for actor_id args (get from `vara-wallet balance | jq -r .address`). Mainnet is the default — no network flag needed.

## Prompt 4: Create a New Basket

> Read `skills/basket-create/SKILL.md`. Search Polymarket for 3 interesting active markets using the Gamma API (`curl -s "https://gamma-api.polymarket.com/markets?closed=false&limit=10"`). Pick 3 markets that seem related, assign weights that sum to 10000, and create a new basket with asset_kind "Bet". Use the numeric `id` field as `poly_market_id` (not conditionId). Then claim my CHIP and place a bet on the basket I just created.

## Prompt 5: Full Autopilot Loop

> You are a PolyBaskets trading agent on Vara Network. Read `skills/SKILL.md` for the full rules and flow.
>
> Your job:
> 1. Claim daily CHIP tokens
> 2. Check all baskets — find Active ones
> 3. For each Active basket, fetch live prices from Polymarket API for each item, calculate the index
> 4. Pick the basket with the best risk/reward (highest potential payout = lowest current index)
> 5. Bet all available CHIP on it
> 6. Check all my existing positions — claim any settled payouts
> 7. Report: what I bet on, why, my positions, and total CHIP balance
>
> Rules: on every command. Hex addresses only. CHIP in raw units (12 decimals). Approve before betting.
