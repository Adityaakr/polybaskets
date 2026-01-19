# BasketMarket Settler Bot

Settler bot that monitors Polymarket Gamma API and proposes/finalizes settlements for BasketMarket contracts on Vara Network.

## Overview

The settler bot:
1. Polls all baskets from the on-chain contract
2. Fetches Polymarket data for each basket's items
3. Checks if all items are resolved (closed + prices at 1/0)
4. Proposes settlement on-chain when all items resolved
5. Finalizes settlements after challenge deadline (optional)

## Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your values
```

## Environment Variables

- `VARA_RPC` - Vara Network WebSocket RPC URL (default: `wss://testnet.vara.network`)
- `PROGRAM_ID` - Your deployed BasketMarket program ID (required)
- `SETTLER_SEED` - Settler account seed phrase for signing transactions (required)
  - **Must match** the `settler_role` used in contract constructor
- `POLYMARKET_POLL_INTERVAL_MS` - Poll interval in milliseconds (default: `30000`)
- `FINALIZE_ENABLED` - Enable automatic finalization after challenge deadline (default: `true`)

## Important: Settler Account

The `SETTLER_SEED` must be the account that was set as `settler_role` in the contract constructor:

```typescript
// Contract constructor was called with:
New(
  settler_role: "0x2e20c7db6cc6c97fd10ec8e6191c6002cdbf3c41085047a6d779605fc702f427",
  liveness_seconds: 720  // 12 minutes
)
```

So the `SETTLER_SEED` must correspond to the account with ActorId `0x2e20c7db6cc6c97fd10ec8e6191c6002cdbf3c41085047a6d779605fc702f427`.

## Usage

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

**Watch mode (auto-reload on changes):**
```bash
npm run watch
```

## How It Works

1. **Discovery:**
   - Fetches basket count from chain (`GetBasketCount`)
   - Loops through all baskets (`GetBasket`)

2. **Resolution Detection:**
   - For each active basket, fetches Polymarket data for all items
   - Checks if all items are resolved:
     - Market is `closed: true`
     - Outcome prices indicate clear winner:
       - YES won: `outcomePrices[0] >= 0.99 && outcomePrices[1] <= 0.01`
       - NO won: `outcomePrices[1] >= 0.99 && outcomePrices[0] <= 0.01`

3. **Propose Settlement:**
   - When all items resolved, creates `ItemResolution` for each item
   - Creates payload (JSON snapshot of Polymarket data)
   - Calls `ProposeSettlement` on-chain

4. **Finalize Settlement (optional):**
   - Checks all settlements in "Proposed" state
   - If challenge deadline has passed, calls `FinalizeSettlement`
   - After finalization, users can claim

## Settlement Flow

```
1. Bot detects all items resolved
2. Bot calls ProposeSettlement
   └─> Settlement enters "Proposed" state
   └─> challenge_deadline = proposed_at + liveness_seconds (12 minutes)
3. Wait for challenge deadline (12 minutes)
4. Bot calls FinalizeSettlement (if FINALIZE_ENABLED=true)
   └─> Settlement enters "Finalized" state
5. Users can now claim payouts
```

## Logging

The bot logs:
- Basket polling status
- Resolution checks
- Settlement proposals (with transaction hash)
- Settlement finalizations
- Errors

Example output:
```
[Basket 0] Fetching Polymarket data for 3 items...
[Basket 0] All items resolved! Proposing settlement...
[Basket 0] ✓ Settlement proposed successfully: tx 0x...
[Basket 0]   Resolutions: YES, YES, NO
[Basket 0] Challenge deadline passed, finalizing settlement...
[Basket 0] ✓ Settlement finalized: tx 0x...
```

## Troubleshooting

- **Connection errors:** Check `VARA_RPC` is correct and network is accessible
- **Permission errors:** Ensure `SETTLER_SEED` account has funds and matches `settler_role` in contract
- **Settlement not proposed:** Check all basket items are resolved on Polymarket
- **Transaction failures:** Verify program ID is correct and program is deployed
- **Finalization not happening:** Check challenge deadline has passed (12 minutes after proposal)

## Architecture

```
┌─────────────────┐
│  Settler Bot    │
│  (Node.js)      │
│                 │
│ • Polls Chain  │
│ • Monitors Poly│
│ • Proposes     │
│ • Finalizes    │
└────────┬────────┘
         │
         │ (calls)
         ▼
┌─────────────────┐
│  Vara Network   │
│  (On-Chain)     │
│                 │
│ • BasketMarket  │
│   Contract      │
└────────┬────────┘
         │
         │ (fetches)
         ▼
┌─────────────────┐
│  Polymarket     │
│  Gamma API      │
└─────────────────┘
```
