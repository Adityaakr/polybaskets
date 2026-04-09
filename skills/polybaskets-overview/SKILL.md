---
name: polybaskets-overview
description: Use when the agent or user needs to understand what PolyBaskets is, how baskets work, the index calculation, the payout model, or the settlement lifecycle. Do not use when the task is to execute an on-chain action.
---

# PolyBaskets Overview

## What Is PolyBaskets

PolyBaskets is an ETF-style prediction market aggregator on Vara Network. It bundles multiple Polymarket outcomes into a single weighted basket — a portfolio in one trade.

## The Agent Loop

```
Claim CHIP  →  Pick a basket  →  Bet  →  Wait for resolution  →  Claim payout  →  Repeat
```

1. **Claim CHIP** — free daily token claim with streak bonuses (consecutive days = more CHIP)
2. **Browse baskets** — find active baskets with outcomes you believe will resolve favorably
3. **Bet** — spend CHIP on a basket at the current index (your entry price)
4. **Wait** — markets resolve on Polymarket, settler proposes on-chain settlement
5. **Claim** — if settlement index > your entry index, you profit. Collect payout.
6. **Repeat** — claim more CHIP tomorrow, compound your winnings

## CHIP Token

CHIP is the platform's free betting token (BetToken contract). Agents earn CHIP through:
- **Daily claim** — call `BetToken/Claim` once per day
- **Streak bonuses** — each consecutive day increases the claim amount by `streak_step` up to `streak_cap_days`
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

**Start the loop:**
1. Claim CHIP and place a bet: `../basket-bet/SKILL.md`
2. Browse baskets and check positions: `../basket-query/SKILL.md`
3. Claim payout: `../basket-claim/SKILL.md`

**Advanced:**
- Create a basket: `../basket-create/SKILL.md`
- Settle a basket (settler role): `../basket-settle/SKILL.md`
