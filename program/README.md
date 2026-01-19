# Polymarket Mirror Vara Program

On-chain smart contract for mirroring Polymarket prediction markets on Vara Network.

## Overview

This Gear/Vara program enables:
- Creating mirrored markets from Polymarket
- Placing bets on YES/NO outcomes with native TVARA
- Resolution by trusted relayer
- Pro-rata payout claims for winners

## Program Structure

### State

- **Config**: Relayer address, fee basis points, fee receiver
- **Markets**: Array of market data (pools, resolution status, etc.)
- **Positions**: User positions per market (YES/NO amounts, claimed status)

### Actions

- `Init`: Initialize program with relayer and fee config
- `CreateMarket`: Create a new mirrored market
- `BetYes`: Place bet on YES outcome (with msg.value)
- `BetNo`: Place bet on NO outcome (with msg.value)
- `ResolveMarket`: Resolve market (relayer only)
- `Claim`: Claim payout after resolution
- `GetMarket`: Query market state
- `GetPosition`: Query user position
- `GetMarketCount`: Get total market count

### Events

- `MarketCreated`
- `BetPlaced`
- `MarketResolved`
- `Claimed`
- `MarketData`
- `PositionData`
- `MarketCount`
- `Error`

## Building

### Prerequisites

- Rust (latest stable) with `rustup target add wasm32v1-none`
- Cargo and Gear/Sails toolchain (`cargo install sails-cli`)
- macOS: `xcode-select --install` (or GCC/Clang on Linux)

### Build (Wasm + IDL)

```bash
cargo build --release
```

Outputs:
- `target/wasm32-gear/release/polymarket_mirror.wasm`
- `target/wasm32-gear/release/polymarket_mirror.opt.wasm` (deploy this)
- `polymarket-mirror.idl` (auto-generated interface)

## Deployment

1. **Upload the program** to Vara Network using Gear/Gearify or similar tool
2. **Initialize** the program with:
   ```rust
   Init {
       relayer: <relayer_actor_id>,
       fee_bps: 100,  // 1%
       fee_receiver: <fee_receiver_actor_id>,
   }
   ```
3. **Save the program ID** for frontend and relayer configuration

## Testing

```bash
# Unit tests (if added)
cargo test

# Integration tests (requires testnet/test setup)
```

## Safety Features

- Only relayer can resolve markets
- Markets cannot accept bets after resolution
- Positions marked as claimed before transfer (prevents re-entrancy)
- Integer math with safe division
- Maximum 2 outcomes enforced
- Payout calculation handles edge cases (zero pools, etc.)

## Fee Model

- Configurable fee in basis points (e.g., 100 = 1%)
- Fee deducted from total pool before distribution
- Fee sent to configured fee receiver
- If winning pool is zero, distributable amount goes to fee receiver

## Payout Math

```
total = yes_pool + no_pool
fee = total * fee_bps / 10000
distributable = total - fee

If YES wins:
  payout = distributable * user_yes_amount / yes_pool

If NO wins:
  payout = distributable * user_no_amount / no_pool
```

## IDL/Type Definitions

For frontend and relayer integration, use the TypeScript types defined in:
- `/frontend/src/lib/varaClient.ts`
- `/relayer/src/vara.ts`

These match the Rust types and provide type-safe interfaces.

## Notes

- Uses native TVARA transfers (no ERC20)
- All amounts in program use `u128` (native Vara balance units)
- Market IDs are sequential u64 starting from 0
- Outcomes array must be exactly 2 elements (binary market)
