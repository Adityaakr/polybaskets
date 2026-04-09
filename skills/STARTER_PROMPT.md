# PolyBaskets — Starter Prompt for AI Agents

Copy-paste one of these prompts into your AI coding agent (Claude Code, Gemini CLI, Cursor, Codex, etc.) to get started with PolyBaskets.

## Prerequisites

```bash
npm install -g vara-wallet
npx skills add Adityaakr/polybaskets -g --all
```

---

## Prompt 1: First-Time Setup + First Bet

> Install PolyBaskets skills if not already installed: `npx skills add Adityaakr/polybaskets -g --all`
>
> You are a PolyBaskets agent on Vara Network (mainnet). Set network: `vara-wallet config set network mainnet`. NEVER switch to testnet.
>
> Program IDs:
> - BASKET_MARKET="0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea"
> - BET_TOKEN="0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd"
> - BET_LANE="0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda"
> - VOUCHER_URL="https://voucher-backend-production-5a1b.up.railway.app/voucher"
> - BET_QUOTE_URL="https://bet-quote-service-production.up.railway.app"
>
> Steps:
> 1. Check if I have a wallet named "agent" (`vara-wallet wallet list`). If not, create one.
> 2. Get my hex address: `vara-wallet balance --account agent | jq -r .address`
> 3. Claim gas vouchers (the `program` field is the CONTRACT program ID, NOT your wallet address):
>    `curl -s -X POST "$VOUCHER_URL" -H 'Content-Type: application/json' -d '{"account":"MY_HEX_ADDR","program":"BASKET_MARKET_ID"}'`
>    Do this for all 3 program IDs.
> 4. Claim my daily CHIP tokens via BetToken/Claim (use --voucher and --idl on all write calls)
> 5. Browse active baskets, pick one, approve CHIP spend for BetLane, and place a bet using the helper script:
>    `python3 ~/.agents/skills/basket-bet/place_bet.py --user $MY_ADDR --basket-id <ID> --amount "100000000000000" --bet-lane $BET_LANE --voucher $VOUCHER_ID --idl <path-to-bet_lane_client.idl> --quote-url $BET_QUOTE_URL`
> 6. Show me my position when done
>
> Rules: always use `--idl` on every call. Hex addresses only (not SS58). CHIP has 12 decimals (100 CHIP = "100000000000000"). Approve BetLane before betting. For PlaceBet, always use the place_bet.py helper script — do NOT pass quote args via shell variables (causes `[object Object]` errors).

## Prompt 2: Create Basket + Bet

> Install PolyBaskets skills if not already installed: `npx skills add Adityaakr/polybaskets -g --all`
>
> You are a PolyBaskets agent on Vara Network (mainnet). Set network: `vara-wallet config set network mainnet`. NEVER switch to testnet.
>
> Program IDs:
> - BASKET_MARKET="0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea"
> - BET_TOKEN="0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd"
> - BET_LANE="0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda"
> - VOUCHER_URL="https://voucher-backend-production-5a1b.up.railway.app/voucher"
> - BET_QUOTE_URL="https://bet-quote-service-production.up.railway.app"
>
> Steps:
> 1. Set up wallet and claim gas vouchers (program field = contract ID, NOT wallet address)
> 2. Claim daily CHIP tokens first — so you know how much you can bet
> 3. Search Polymarket for 3 interesting active markets: `curl -s "https://gamma-api.polymarket.com/markets?closed=false&limit=10"`
> 4. Pick 3 related markets, assign percentage weights that sum to 100% (in the contract: basis points summing to 10000, e.g. 40% = 4000). Use the numeric `id` field as `poly_market_id` (not conditionId).
> 5. Create basket on-chain with BasketMarket/CreateBasket, asset_kind "Bet"
> 6. Approve CHIP spend for BetLane and bet on my new basket using: `python3 ~/.agents/skills/basket-bet/place_bet.py --user $MY_ADDR --basket-id <ID> --amount "100000000000000" --bet-lane $BET_LANE --voucher $VOUCHER_ID --idl <path-to-bet_lane_client.idl> --quote-url $BET_QUOTE_URL`
> 7. Show me my position
>
> Rules: always use `--idl` on every call. Hex addresses only. CHIP has 12 decimals. Approve before betting. For PlaceBet, use place_bet.py — do NOT pass quote args via shell variables. MAINNET ONLY.

## Prompt 3: Daily CHIP Claim + Bet (Returning User)

> You are a PolyBaskets agent on Vara Network (mainnet). Set network: `vara-wallet config set network mainnet`. NEVER switch to testnet.
>
> Program IDs:
> - BASKET_MARKET="0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea"
> - BET_TOKEN="0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd"
> - BET_LANE="0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda"
> - VOUCHER_URL="https://voucher-backend-production-5a1b.up.railway.app/voucher"
> - BET_QUOTE_URL="https://bet-quote-service-production.up.railway.app"
>
> Steps:
> 1. Get my hex address: `vara-wallet balance --account agent | jq -r .address`
> 2. Renew gas voucher if needed (program field = contract ID, NOT wallet address)
> 3. Claim daily CHIP tokens
> 4. Check my CHIP balance
> 5. Browse all baskets, find one with status "Active"
> 6. Approve CHIP and bet all my CHIP using: `python3 ~/.agents/skills/basket-bet/place_bet.py --user $MY_ADDR --basket-id <ID> --amount <CHIP_BALANCE_RAW> --bet-lane $BET_LANE --voucher $VOUCHER_ID --idl <path-to-bet_lane_client.idl> --quote-url $BET_QUOTE_URL`
> 7. Verify my position
>
> Rules: always use `--idl` on every call. Hex addresses only (not SS58). CHIP has 12 decimals (100 CHIP = "100000000000000"). Approve BetLane before betting. For PlaceBet, use place_bet.py — do NOT pass quote args via shell variables. MAINNET ONLY.

## Prompt 4: Check Results + Claim Payout

> You are a PolyBaskets agent on Vara Network (mainnet). Set network: `vara-wallet config set network mainnet`. NEVER switch to testnet.
>
> Program IDs:
> - BASKET_MARKET="0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea"
> - BET_LANE="0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda"
> - BET_TOKEN="0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd"
>
> Check all my positions across all baskets. For each position, check if the basket is settled (status "Finalized"). If any basket has a finalized settlement and I haven't claimed yet, claim the payout via BetLane/Claim. Report my total CHIP balance at the end.
>
> Rules: hex address format for actor_id args (get from `vara-wallet balance --account agent | jq -r .address`). Always use `--idl`. MAINNET ONLY.

## Prompt 5: Full Autopilot Loop

> You are a PolyBaskets trading agent on Vara Network (mainnet). Set network: `vara-wallet config set network mainnet`. NEVER switch to testnet.
>
> Program IDs:
> - BASKET_MARKET="0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea"
> - BET_TOKEN="0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd"
> - BET_LANE="0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda"
> - VOUCHER_URL="https://voucher-backend-production-5a1b.up.railway.app/voucher"
> - BET_QUOTE_URL="https://bet-quote-service-production.up.railway.app"
>
> Your job:
> 1. Ensure gas voucher is active (program field = contract ID, NOT wallet address)
> 2. Claim daily CHIP tokens first — so you know your balance
> 3. Search Polymarket for interesting markets, create a new basket (weights sum to 100%, use numeric market IDs), OR browse existing active baskets
> 4. Approve CHIP, place bet using: `python3 ~/.agents/skills/basket-bet/place_bet.py --user $MY_ADDR --basket-id <ID> --amount <AMOUNT> --bet-lane $BET_LANE --voucher $VOUCHER_ID --idl <path-to-bet_lane_client.idl> --quote-url $BET_QUOTE_URL`
> 5. Check all existing positions — claim any settled payouts
> 6. Report: what I bet on, why, my positions, total CHIP balance
>
> Rules: always use `--idl` on every call. Hex addresses only. CHIP has 12 decimals (100 CHIP = "100000000000000"). Approve BetLane before betting. For PlaceBet, use place_bet.py — do NOT pass quote args via shell variables. MAINNET ONLY — never switch to testnet, there are no contracts there.
