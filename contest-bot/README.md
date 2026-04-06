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

- `contest-bot` and `settler-bot` use the same shared signer secret
- set exactly one of `SETTLER_SEED` or `SETTLER_SEED_FILE`
- no fallback mnemonic is embedded in the code
- Railway should prefer `SETTLER_SEED`
- Railway should point `INDEXER_GRAPHQL_ENDPOINT` at the internal/private `indexer-api` URL by default

```bash
docker compose \
  --env-file .env \
  --env-file .env.secrets \
  -f docker-compose.yml \
  up --build contest-bot
```

```bash
docker compose \
  --env-file .env \
  --env-file .env.secrets \
  -f docker-compose.yml \
  logs -f contest-bot
```
