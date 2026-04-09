# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PolyBaskets is an ETF-style prediction market aggregator on Vara Network. Users bundle multiple Polymarket outcomes into weighted baskets and bet on them as a single on-chain position.

## Commands

### Frontend (root directory)
```bash
npm run dev          # Vite dev server on :8080 with Polymarket CORS proxy at /gamma
npm run build        # Production build
npm run build:dev    # Development build with debug info
npm run lint         # ESLint
```

### Smart Contracts (program/, bet-token/, bet-lane/, daily-contest/)
```bash
cd program && cargo build --release
cd program && cargo test
```

### Backend Services
```bash
# Settler Bot (settler-bot/)
cd settler-bot && npm run dev          # tsx watch mode

# Bet Quote Service (bet-quote-service/)
cd bet-quote-service && npm run dev    # tsx watch on :4360

# Indexer (indexer/)
cd indexer && npm run processor        # Subsquid event processor
cd indexer && npm run serve            # PostGraphile GraphQL on :4350
cd indexer && npm run migration:run    # Run TypeORM migrations

# Contest Bot (contest-bot/)
cd contest-bot && npm run build && npm start

# Voucher Backend (voucher-backend/) — NestJS
cd voucher-backend && npm run start:dev
cd voucher-backend && npm run test
```

### Docker Compose (full backend stack)
```bash
cp .env.example .env && cp .env.secrets.example .env.secrets
# Fill chain/program env in .env, secrets in .env.secrets
docker compose --env-file .env --env-file .env.secrets -f docker-compose.yml up --build
```
Services: postgres, indexer-migrate, indexer-processor, indexer-api (:4350), bet-quote-service (:4360), contest-bot, settler-bot.

## Architecture

### Frontend (`src/`)
- **React 18 + TypeScript + Vite** with SWC, TailwindCSS, shadcn/ui
- Path alias: `@/*` maps to `./src/*`
- Provider nesting: QueryClient > NetworkProvider > GearProviders (Vara only) > WalletProvider > BasketProvider > Router
- **Routes**: `/` (landing), `/explorer`, `/builder`, `/basket/:id`, `/claim`, `/me`, `/leaderboard`
- **Key lib files**:
  - `polymarket.ts` — Polymarket Gamma API client (market search, prices, resolution)
  - `basket-onchain.ts` — Vara Network contract interactions via Sails
  - `varaEthBasketClient.ts` — Vara.eth (EVM) contract interactions via viem
  - `basket-utils.ts` — Weighted index calculation
  - `betCalculator.ts` — Payout math: `shares * (settlement_index / entry_index)`
  - `betPrograms.ts` — On-chain program queries
- **Contexts**: NetworkContext (vara vs varaeth toggle), WalletContext, BasketContext
- **Generated Sails clients**: `basket-market-client/`, `bet-lane-client/`, `bet-token-client/`, `vara-client/` — manually maintained, not auto-generated from IDL

### Smart Contracts
- **`program/`** — BasketMarket: create baskets, track positions, handle settlements (IDL: `program/polymarket-mirror.idl`)
- **`bet-token/`** — Fungible Token (FT) for the betting lane
- **`bet-lane/`** — Alternative betting lane using FT tokens
- **`daily-contest/`** — Daily contest markets (separate Sails program)
- All use Rust with Sails framework on Vara Network (Gear Protocol)

### Backend Services
- **Settler Bot** (`settler-bot/`) — Polls Polymarket for resolved markets, calls ProposeSettlement, waits 12-min challenge window, then FinalizeSettlement
- **Bet Quote Service** (`bet-quote-service/`) — Signs bet quotes before on-chain submission; signer seed must differ from settler seed
- **Indexer** (`indexer/`) — Subsquid processor that indexes on-chain events into PostgreSQL, exposes PostGraphile GraphQL API
- **Contest Bot** (`contest-bot/`) — Monitors daily-contest program, triggers challenge/settlement
- **Voucher Backend** (`voucher-backend/`) — NestJS service for gas voucher distribution
- **Relayer** (`relayer/`) — Legacy, likely superseded by settler-bot

### Dual Network Support
The frontend supports two networks controlled by `NetworkContext`:
- **Vara** — Native TVARA tokens, Sails contract calls (`basket-onchain.ts`)
- **Vara.eth** — EVM-based, uses viem (`varaEthBasketClient.ts`)

`VITE_ENABLE_VARA` controls native VARA asset flow (default: off = CHIP-only mode).

### AI Agent Skills (`skills/`)
Skill pack for AI agents to interact with baskets on-chain: basket-bet, basket-query, basket-claim, basket-create, basket-settle, polybaskets-overview. IDL files in `skills/references/`.

## Key Environment Variables

### Frontend (Vite)
- `VITE_PROGRAM_ID` — BasketMarket contract address
- `VITE_NODE_ADDRESS` — Vara RPC (default: `wss://testnet.vara.network`)
- `VITE_BET_TOKEN_PROGRAM_ID`, `VITE_BET_LANE_PROGRAM_ID` — Token/lane contracts
- `VITE_INDEXER_GRAPHQL_ENDPOINT` — Indexer GraphQL URL (default: `http://localhost:4350/graphql`)
- `VITE_BET_QUOTE_SERVICE_URL` — Quote service URL (default: `http://127.0.0.1:4360`)
- `VITE_VARAETH_RPC`, `VITE_VARAETH_ROUTER` — Vara.eth EVM endpoints
- `VITE_ENABLE_VARA` — Toggle native VARA vs CHIP-only mode

### Backend (via .env.secrets)
- `SETTLER_SEED` or `SETTLER_SEED_FILE` — Settler bot mnemonic (space or comma separated)
- `BET_QUOTE_SIGNER_SEED` or `BET_QUOTE_SIGNER_SEED_FILE` — Quote service signer (must differ from settler)

## TypeScript Config Notes

The project uses lenient TypeScript settings intentionally:
- `noImplicitAny: false`, `strictNullChecks: false`, `noUnusedLocals: false`
- ESLint allows unused variables

## Deployment

- Frontend deployed on Railway (auto-deploy from main)
- Backend services containerized via docker-compose
- Polymarket API proxied through Vite (`/gamma`) in dev; direct in production
- Sails client versions: sails-js v0.5.1 (frontend/settler-bot/bet-quote-service), v0.4.3 (indexer/contest-bot)

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
