# Contest Bot

Dedicated settlement bot for daily CHIP competition.

The bot is a long-running polling service, not a single-shot command.

## Responsibility

- read unsettled daily winner sets from the indexer
- wait for post-midnight grace period and indexer completeness
- submit final day settlement to `DailyContest`
- support both normal winner days and `NoWinner` days
- settle oldest unsettled day first
- sleep for `CONTEST_BOT_POLL_INTERVAL_MS` between polling iterations

## Non-Responsibility

- basket settlement remains in `settler-bot`
- read-model calculation remains in the indexer

## Adapters

- `adapters/graphql-read-model.ts` reads the primary `/graphql` read surface
- `adapters/daily-contest-chain.ts` submits `SettleDay` transactions to the `DailyContest` program

## Time Source

- `settlementAllowedAt` is canonical in the read model
- the bot does not keep its own grace-period arithmetic

## Docker Compose

Run with the repo-root stack:

- `docker compose --env-file .env.daily-contest -f docker-compose.daily-contest.yml up --build contest-bot`
- `docker compose --env-file .env.daily-contest -f docker-compose.daily-contest.yml logs -f contest-bot`
