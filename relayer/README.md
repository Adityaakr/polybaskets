# Polymarket Mirror Relayer

Centralized relayer that polls Polymarket Gamma API and resolves markets on Vara Network when they close.

## Overview

The relayer:
1. Loads a list of mirrored markets from `markets.json`
2. Polls Polymarket API every 30 seconds (configurable)
3. Detects when markets are resolved using multiple signals:
   - Market is closed (`closed: true`)
   - Outcome prices are hard 1/0 or close (>= 0.99 / <= 0.01)
   - UMA resolution status indicates final (if present)
4. Calls `resolveMarket()` on the Vara program when a market resolves
5. Stores resolver payload on-chain for transparency

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

3. **Create `markets.json`** (or let it auto-create):
```json
[
  {
    "marketId": 0,
    "polySlug": "will-trump-win-2024",
    "polyId": "0x123...",
    "lastStatus": "active"
  }
]
```

## Environment Variables

- `VARA_RPC` - Vara Network WebSocket RPC URL (default: `wss://rpc.vara.network`)
- `VARA_PROGRAM_ID` - Your deployed Vara program ID (required)
- `RELAYER_SEED` - Relayer account seed phrase for signing transactions (required)
- `POLYMARKET_POLL_INTERVAL_MS` - Poll interval in milliseconds (default: `30000`)
- `MARKETS_FILE` - Path to markets JSON file (default: `./markets.json`)
- `LOG_LEVEL` - Logging level (default: `info`)

See `.env.example` for a filled-in template with the testnet endpoint and a placeholder for your mnemonic.

## Generated Sails client

The TypeScript client for the on-chain program is generated from `program/polymarket-mirror.idl` and lives in `sails-client/lib.ts`. It is consumed by the relayer to query and send messages.

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

1. **Market Resolution Detection:**
   - Markets must be `closed: true`
   - Outcome prices must indicate clear winner (one at ~1.0, other at ~0.0)
   - Optionally checks UMA resolution status
   - If ambiguous or disputed, the relayer does NOT resolve

2. **Idempotency:**
   - Before resolving, checks if market is already resolved on-chain
   - Skips markets that are already resolved

3. **Resolver Payload:**
   - Stores JSON payload on-chain containing:
     - Polymarket ID and slug
     - Closed timestamp
     - Outcome prices at resolution
     - UMA resolution status
   - This provides transparency and auditability

## Adding Markets

Manually edit `markets.json` or use the frontend "Create Mirror" page to add markets. The relayer will automatically start monitoring them.

## Troubleshooting

- **Connection errors:** Check `VARA_RPC` is correct and network is accessible
- **Permission errors:** Ensure `RELAYER_SEED` account has funds and is set as relayer in program
- **Resolution not happening:** Check market is actually closed and prices are clear 1/0
- **Transaction failures:** Verify program ID is correct and program is deployed
