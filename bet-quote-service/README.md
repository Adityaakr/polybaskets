# Bet Quote Service

Dedicated quote-signing backend for `BetLane`.

Responsibilities:

- read active BET baskets from `BasketMarket`
- fetch live market prices from Polymarket Gamma
- compute `quoted_index_bps`
- sign canonical SCALE quote payloads with a dedicated quote signer secret
- return `SignedBetQuote` to the frontend

This service is part of the existing stack alongside `indexer-api`, `contest-bot`, and `settler-bot`.

## Required env

- `VARA_RPC_URL`
- `BASKET_MARKET_PROGRAM_ID`
- `BET_LANE_PROGRAM_ID`
- `BET_QUOTE_SIGNER_SEED` or `BET_QUOTE_SIGNER_SEED_FILE`
- `BET_QUOTE_TTL_MS`
- `BET_QUOTE_SERVICE_PORT`
- `FRONTEND_URLS`
- `POLYMARKET_GAMMA_BASE_URL`

`BET_QUOTE_SIGNER_SEED` accepts a standard mnemonic with either spaces or comma-separated words.

## Local run

```bash
cd bet-quote-service
npm install
npm run build
node dist/index.js
```

Health:

```bash
curl http://127.0.0.1:4360/healthz
```

Quote:

```bash
curl -X POST http://127.0.0.1:4360/api/bet-lane/quote \
  -H 'content-type: application/json' \
  -d '{"targetProgramId":"0x...","user":"0x...","basketId":1,"amount":"1000000000000"}'
```
