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
- contest day is UTC `00:00:00.000` to `23:59:59.999`
- realized profit is assigned by `SettlementFinalized.finalized_at`, not by claim day
- ties are preserved as multiple winners with equal max realized profit
- empty closed days are materialized as `no_winner` because current policy is `settle_no_winner`
- empty closed days are materialized only from the UTC day of the first processed block at or after `VARA_FROM_BLOCK`
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
- frontend-safe CORS enabled through `FRONTEND_URLS`
- bot and frontend are expected to query projected tables, not recompute contest state in the API layer
- the compose stack is `postgres + indexer-migrate + indexer-processor + indexer-api + contest-bot + settler-bot`

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
- `docker compose --env-file .env --env-file .env.secrets -f docker-compose.yml logs -f contest-bot`
- `docker compose --env-file .env --env-file .env.secrets -f docker-compose.yml logs -f settler-bot`
