# PolyBaskets Program IDs and Network Config

## Shell Variables

Copy-paste this block at the start of any PolyBaskets interaction session:

```bash
# Program IDs (Vara mainnet)
# TODO: update these with mainnet deployment addresses before launch
BASKET_MARKET="0x702395d43248eaa5f1fd4d9eadadc75b0fb1c7c5ae9ea20bf31375fd4358f403"
BET_TOKEN="0x41be634b690ecde3d79f63ea2db9834b8570a6d4abb3c0be47af3947e3129ece"
BET_LANE="0xf5aa436669bb3fc97c1675d06949592e8617f889cbd055451f321113b17bb564"

# IDL paths (relative to skill pack root)
_PB="${POLYBASKETS_SKILLS_DIR:-skills}"
IDL="$_PB/idl/polymarket-mirror.idl"
BET_TOKEN_IDL="$_PB/idl/bet_token_client.idl"
BET_LANE_IDL="$_PB/idl/bet_lane_client.idl"
```

If running from the polybaskets repo root, IDL files are also at:
- `program/polymarket-mirror.idl`
- `bet-token/client/bet_token_client.idl`
- `bet-lane/client/bet_lane_client.idl`

## Program Roles

| Program | Purpose |
|---------|---------|
| BasketMarket | Core contract: baskets, CHIP bets, settlements, claims |
| BetToken | CHIP fungible token with daily claim and streak bonuses |
| BetLane | Betting lane using CHIP tokens |

## Network

Vara mainnet (`wss://rpc.vara.network`) is vara-wallet's default. No `--network` flag or env var needed.

```bash
# Just works — mainnet by default
vara-wallet call $BASKET_MARKET BasketMarket/GetBasketCount --args '[]' --idl $IDL
```

## Gas — Voucher System

Agents get gas through the PolyBaskets voucher claim process. No VARA purchase needed.

```bash
# TODO: add voucher claim command/URL when the process is finalized
```

## Actor ID Format

Sails `actor_id` args require **hex format** — SS58 addresses are rejected:

```bash
# Get your hex address
MY_ADDR=$(vara-wallet balance | jq -r .address)
# → 0xe00801c1a5b8aef60d3a...
```

## Token Units

Both VARA and CHIP use 12 decimals. Method args for `u256`/`u128` amounts expect **raw units**:
- 100 CHIP = `"100000000000000"` (100 * 10^12)
- 1 CHIP = `"1000000000000"` (10^12)
- `--value` flag (for VARA lane) auto-converts from VARA by default

## vara-wallet Response Format

All vara-wallet output is JSON:

```bash
# Queries return:
{"result": <value>}                          # plain types (u64, bool, str)
{"result": {"ok": {...}}}                    # Result<T, E> success
{"result": {"err": "ErrorVariant"}}          # Result<T, E> error

# Mutations return:
{"txHash": "0x...", "blockHash": "0x...", "blockNumber": 123, "messageId": "0x...", "result": <value>}
```

Extract values with jq:
```bash
# Query result
vara-wallet ... | jq -r '.result'
vara-wallet ... | jq '.result.ok'

# Mutation result
vara-wallet ... | jq -r '.result'
```
