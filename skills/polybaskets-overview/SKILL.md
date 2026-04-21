---
name: polybaskets-overview
description: Use when the agent or user needs to understand what PolyBaskets is, how baskets work, the index calculation, the payout model, or the settlement lifecycle. Do not use when the task is to execute an on-chain action.
---

# PolyBaskets Overview

## What Is PolyBaskets

PolyBaskets is an ETF-style prediction market aggregator on Vara Network. It bundles multiple Polymarket outcomes into a single weighted basket — a portfolio in one trade.

## The Agent Loop

```
Claim CHIP  →  Search markets  →  Build basket  →  Create on-chain  →  Bet  →  Wait  →  Claim payout
```

1. **Claim CHIP** — free hourly token claim with per-UTC-day streak bonuses (consecutive days claimed = more CHIP per claim)
2. **Search Polymarket** — find interesting active markets via the Gamma API
3. **Build your basket** — pick 1-10 markets, choose YES/NO for each, assign percentage weights (must sum to 100%)
4. **Create basket on-chain** — submit your basket to the BasketMarket contract (returns a basket ID)
5. **Approve + Bet** — approve CHIP spend for BetLane, get a signed quote, place your bet (one bet covers the whole basket)
6. **Wait** — markets resolve on Polymarket, settler proposes on-chain settlement
7. **Claim** — if settlement index > your entry index, you profit. Collect payout.
8. **Repeat** — claim more CHIP in an hour, bet on your own or someone else's basket

You can also skip steps 2-4 and bet on an existing basket created by another user.

## CHIP Token

CHIP is the platform's free betting token (BetToken contract). Agents earn CHIP through:
- **Hourly claim** — call `BetToken/Claim` once per hour. Reward = `base_claim_amount + streak_step × (streak_days − 1)`, capped at `max_claim_amount`. Season 2 defaults: 500 base, +10/streak-day, max 600.
- **Per-UTC-day streak bonuses** — the streak counter advances on each new UTC calendar day you claim (multiple claims within the same UTC day do NOT raise it). Miss a full UTC day → streak resets to 1. Cap is `streak_cap_days` (default 11).
- **Winning bets** — payouts from settled baskets

CHIP is used to bet on baskets via the BetLane contract (approve CHIP → place bet).

## Core Concepts

### Basket

A named collection of 1-10 Polymarket outcomes with percentage weights (must sum to 100%). Each item specifies:
- A Polymarket market (by numeric ID and slug)
- A selected outcome (YES or NO)
- A weight in basis points (e.g. 40% = 4000 bps, all must sum to 10000 bps = 100%)

### Basket Index

The index is a weighted probability score:

```
index = sum( weight_bps[i] / 10000 * probability[i] )
```

Ranges from 0.0 to 1.0. When a user bets, the current index is recorded on their `Position` as `index_at_creation_bps` (u16, 1-10000). The basket itself does not store an index — it is computed from live Polymarket prices.

See `../references/index-math.md` for formulas and worked examples.

### Position

A user's bet on a basket. Records:
- `shares` — amount of VARA (or BET tokens) wagered
- `index_at_creation_bps` — the basket index when the bet was placed (entry price)
- `claimed` — whether payout has been collected

### Payout

After settlement:

```
payout = shares * (settlement_index / entry_index)
```

If settlement index > entry index: profit. If lower: loss.

### Settlement Lifecycle

```
Active  →  SettlementPending  →  Settled
           (12-min challenge)     (users can claim)
```

1. **Active** — basket accepts bets
2. **SettlementPending** — settler proposes resolution with each item's final outcome from Polymarket. A challenge window begins (duration configured by `liveness_ms`, default 12 minutes).
3. **Settled** — after the challenge window, settler finalizes. Users can now claim payouts.

## Three Programs

| Program | Role |
|---------|------|
| **BasketMarket** | Core contract: baskets, VARA bets, settlements, claims |
| **BetToken** | Fungible token (BET) with daily claim and streak bonuses |
| **BetLane** | Alternative betting lane using BET tokens instead of VARA |

## Two Asset Kinds

Each basket has an `asset_kind` set at creation:

- **Bet (CHIP)** — the default. Users bet with CHIP tokens via BetLane (claim daily → approve → bet). This is the primary path for agents.
- **Vara** — users bet with native TVARA tokens via BasketMarket. May be disabled on some deployments.

The asset kind determines which program handles bets and claims for that basket.

## Where to Go Next

**Full flow (recommended):**
1. Claim CHIP tokens: `../basket-bet/SKILL.md` (Step 1)
2. Search markets and create a basket: `../basket-create/SKILL.md`
3. Approve and bet on your basket: `../basket-bet/SKILL.md` (Steps 4-5)
3. Browse baskets and check positions: `../basket-query/SKILL.md`
4. Claim payout: `../basket-claim/SKILL.md`

**Settler role only:**
- Settle a basket: `../basket-settle/SKILL.md`
