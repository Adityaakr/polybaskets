# BasketMarket Settler Bot

Settlement bot for `BasketMarket`. It watches Polymarket Gamma, proposes basket settlements, and optionally finalizes them after the challenge window.

## Responsibility

- poll all baskets from `BasketMarket`
- fetch Polymarket data for basket items
- propose settlement when every item is resolved
- finalize proposed settlements after the challenge deadline when enabled

## Environment Contract

Required:

- `VARA_RPC_URL`
- `BASKET_MARKET_PROGRAM_ID`
- exactly one of:
  - `SETTLER_SEED`
  - `SETTLER_SEED_FILE`

Optional operational values:

- `SETTLER_BOT_POLL_INTERVAL_MS` default `30000`
- `SETTLER_BOT_FINALIZE_ENABLED` default `true`
- `POLYMARKET_GAMMA_BASE_URL` default `https://gamma-api.polymarket.com`

The shared signer secret is also consumed by `contest-bot`. No fallback mnemonic is embedded in the code.

Railway note:

- prefer `SETTLER_SEED`
- keep `SETTLER_SEED_FILE` for local/docker unless you explicitly mount a secret file in Railway

## Local Run

```bash
npm install
npm run build
VARA_RPC_URL=... \
BASKET_MARKET_PROGRAM_ID=... \
SETTLER_SEED=... \
npm start
```

## Docker Compose

Run as part of the repo-root daily contest stack:

```bash
docker compose \
  --env-file .env \
  --env-file .env.secrets \
  -f docker-compose.yml \
  up --build settler-bot
```

```bash
docker compose \
  --env-file .env \
  --env-file .env.secrets \
  -f docker-compose.yml \
  logs -f settler-bot
```

## Troubleshooting

- connection issues: verify `VARA_RPC_URL`
- permission failures: verify the shared signer matches `settler_role` and has funds
- settlement not proposed: verify all basket items are resolved on Polymarket
- finalization not happening: verify `SETTLER_BOT_FINALIZE_ENABLED=true` and the challenge deadline has passed
