# Daily Contest Indexer

## Runtime Shape

`Subsquid archive/RPC -> Gear.UserMessageSent -> IDL-driven Sails decode -> TypeORM/Postgres read model -> PostGraphile /graphql`

## Source Of Truth

- `BasketMarket` -> basket metadata + settlement finalization day
- `BetLane` -> CHIP positions and payout formula
- `DailyContest` -> final settled day result
- `indexer` -> projected aggregates only

## Program Inputs

- fixed `BASKET_MARKET_PROGRAM_ID`
- fixed `BET_LANE_PROGRAM_ID`
- fixed `DAILY_CONTEST_PROGRAM_ID`
- IDL paths for all three programs
- `VARA_FROM_BLOCK`
- `CONTEST_GRACE_PERIOD_MS`

## Projection Rules

- only CHIP baskets participate
- contest day is UTC `12:00:00.000` to `11:59:59.999`
- projected activity counts include `BasketCreated`, `BetToken/Approved`, `BetLane/BetPlaced`, `BetLane/Claimed`, and `BetToken/Claimed` when `BET_TOKEN_PROGRAM_ID` is configured
- realized profit is assigned by `SettlementFinalized.finalized_at`, not by claim day
- projected winner ranking is activity-first: `txCount DESC`, then `realizedProfit DESC`, then earlier `lastTxAt`, then deterministic technical tie-breakers
- projected winner is always a single account for a closed day unless the day has no eligible activity
- empty closed days are materialized as `no_winner` because current policy is `settle_no_winner`
- empty closed days are materialized only from the first 12:00 UTC contest window touched by a processed block at or after `VARA_FROM_BLOCK`
- winners for a day are always fully replaced on recompute; stale winners are not retained

## Completeness Semantics

A day is `indexer_complete=true` only when the processor has already ingested a head timestamp at or beyond:

`day_start_ms(day_id + 1) + grace_period_ms`

The canonical `settlement_allowed_at` value is persisted in the read model and must be consumed by `contest-bot`. Bot should not maintain a separate grace-period rule.

## Current MVP Limitation

- `known_gap_detected` is currently a conservative batch-gap signal based on processed block-height discontinuity
- it is not yet a full archive consistency proof
- until archive-level gap detection is added, `indexer_complete` should be treated as production-shaped MVP semantics, not final proof-grade completeness

## API

- primary read surface: PostGraphile mounted at `/graphql`
- frontend-safe CORS enabled through `FRONTEND_URLS`, including wildcard origins like `https://*.vercel.app`
- bot and frontend are expected to query projected tables, not recompute contest state in the API layer
- `allDailyUserActivityAggregates` is the canonical read model for the activity leaderboard UI
- the compose stack is `postgres + indexer-migrate + indexer-processor + indexer-api + bet-quote-service + contest-bot + settler-bot`
- local/docker uses `INDEXER_GQL_PORT`
- Railway public deployment should use `PORT`
- GraphiQL is enabled only in development or when `INDEXER_GRAPHIQL_ENABLED=true`

## Storage

- Postgres-backed TypeORM entities
- migration-based schema in `db/migrations`
- no JSON/in-memory store remains in the runtime path

## Docker Compose

Use the repo-root stack:

1. `cp .env.example .env`
2. `cp .env.secrets.example .env.secrets`
3. fill real chain/program env in `.env`
4. fill exactly one of `SETTLER_SEED` or `SETTLER_SEED_FILE` in `.env.secrets`
5. run:

```bash
docker compose \
  --env-file .env \
  --env-file .env.secrets \
  -f docker-compose.yml \
  up --build
```

Useful logs:

- `docker compose --env-file .env --env-file .env.secrets -f docker-compose.yml logs -f indexer-migrate`
- `docker compose --env-file .env --env-file .env.secrets -f docker-compose.yml logs -f indexer-processor`
- `docker compose --env-file .env --env-file .env.secrets -f docker-compose.yml logs -f indexer-api`
- `docker compose --env-file .env --env-file .env.secrets -f docker-compose.yml logs -f bet-quote-service`
- `docker compose --env-file .env --env-file .env.secrets -f docker-compose.yml logs -f contest-bot`
- `docker compose --env-file .env --env-file .env.secrets -f docker-compose.yml logs -f settler-bot`

Production note:

- expose `indexer-api` and `bet-quote-service` publicly when the frontend is hosted outside the private network
- keep `indexer-processor`, `contest-bot`, and `settler-bot` private workers
- set `INDEXER_GRAPHIQL_ENABLED=false` on Railway unless you explicitly want a public GraphiQL surface
