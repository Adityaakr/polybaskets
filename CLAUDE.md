# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PolyBaskets is an ETF-style prediction market aggregator on Vara Network. Users bundle multiple Polymarket outcomes into weighted baskets and bet on them as a single on-chain position. The system has four main components: a React frontend, three Rust smart contracts (Vara/Sails), a settler bot, and a legacy relayer.

## Commands

### Frontend (root directory)
```bash
npm run dev          # Vite dev server on :8080 with Polymarket CORS proxy
npm run build        # Production build
npm run build:dev    # Development build with debug info
npm run lint         # ESLint
npm run preview      # Preview production build
```

### Smart Contracts (each in program/, bet-token/, bet-lane/)
```bash
cd program && cargo build --release
cd program && cargo test
```

### Settler Bot (settler-bot/)
```bash
cd settler-bot && npm run dev    # Dev with auto-reload
cd settler-bot && npm run build  # Build
cd settler-bot && npm start      # Production
```

Docker: `docker-compose up settler-bot` from root.

## Architecture

### Frontend (`src/`)
- **React 18 + TypeScript + Vite** with SWC, TailwindCSS, shadcn/ui (Radix)
- **Pages**: Index, BuilderPage, BasketPage, ClaimPage, MyBasketsPage, LeaderboardPage
- **Key lib files**:
  - `polymarket.ts` — Polymarket Gamma API client (market search, prices, resolution)
  - `basket-onchain.ts` — Vara Network contract interactions via Sails
  - `varaEthBasketClient.ts` — Vara.eth (EVM) contract interactions via viem
  - `basket-utils.ts` — Weighted index calculation
  - `betCalculator.ts` — Payout math: `shares * (settlement_index / entry_index)`
  - `betPrograms.ts` — On-chain program queries
- **Contexts**: NetworkContext (vara vs varaeth toggle), WalletContext, BasketContext
- **Generated Sails clients**: `basket-market-client/`, `bet-lane-client/`, `bet-token-client/`
- Path alias: `@/*` maps to `./src/*`

### Smart Contracts
- **`program/`** — BasketMarket: create baskets, track positions, handle settlements
- **`bet-token/`** — Fungible Token (FT) for the betting lane
- **`bet-lane/`** — Alternative betting lane using FT tokens
- All use Rust with Sails framework on Vara Network (Gear Protocol)

### Settler Bot (`settler-bot/`)
Automated Node.js service that:
1. Polls Polymarket API every 30s for resolved markets
2. Calls `ProposeSettlement` on-chain when all basket items resolve
3. Waits 12-minute challenge window, then calls `FinalizeSettlement`

### Dual Network Support
The frontend supports two networks controlled by `NetworkContext`:
- **Vara** — Native TVARA tokens, Sails contract calls (`basket-onchain.ts`)
- **Vara.eth** — EVM-based, uses viem (`varaEthBasketClient.ts`)

`VITE_ENABLE_VARA` feature flag controls whether native VARA asset flow is enabled (default: off, FT mode).

## Key Environment Variables

### Frontend (Vite)
- `VITE_PROGRAM_ID` — BasketMarket contract address
- `VITE_NODE_ADDRESS` — Vara RPC (default: `wss://testnet.vara.network`)
- `VITE_BET_TOKEN_PROGRAM_ID`, `VITE_BET_LANE_PROGRAM_ID` — Token/lane contracts
- `VITE_VARAETH_RPC`, `VITE_VARAETH_ROUTER` — Vara.eth EVM endpoints
- `VITE_ENABLE_VARA` — Toggle native VARA vs FT mode

### Settler Bot
- `VARA_RPC`, `PROGRAM_ID`, `SETTLER_SEED`, `POLYMARKET_POLL_INTERVAL_MS`, `FINALIZE_ENABLED`

## TypeScript Config Notes

The project uses lenient TypeScript settings intentionally:
- `noImplicitAny: false`, `strictNullChecks: false`, `noUnusedLocals: false`
- ESLint allows unused variables

## Deployment

- Frontend deployed on Railway (auto-deploy from main)
- Settler bot containerized via docker-compose (Node 18 Alpine)
- Polymarket API proxied through Vite in dev; direct in production

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
