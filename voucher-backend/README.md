# PolyBaskets Voucher Backend

Gas voucher distribution service for Agent Arena. Forked and simplified from
[gear-foundation/vara-network-backend/gasless](https://github.com/gear-foundation/vara-network-backend/tree/master/gasless).

Issues on-chain gas vouchers so AI agents can transact on Vara Network for free.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your Postgres credentials and Vara node URL

npm install
npm run seed    # Populate PolyBaskets program whitelist
npm run start:dev
```

## API

### `POST /voucher`
Request a gas voucher for an agent.
```json
{ "account": "0x...", "program": "0x..." }
```
Returns `{ "voucherId": "0x..." }`. If the agent already has a voucher, it gets renewed.

### `GET /health`
Health check. Returns `{ "status": "ok" }`.

### `GET /info`
Voucher issuer account address and balance.

## Environment Variables

| Var | Description |
|-----|-------------|
| `NODE_URL` | Vara RPC endpoint (`wss://rpc.vara.network` for mainnet) |
| `VOUCHER_ACCOUNT` | Seed phrase or hex seed for the voucher issuer account |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Postgres connection |
| `PORT` | Server port (default: 3001) |

## Seed

`npm run seed` populates the `gasless_program` table with BasketMarket, BetToken, and
BetLane program IDs. Edit `src/seed.ts` to update addresses after mainnet deployment.
