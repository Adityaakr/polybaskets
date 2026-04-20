# Daily Contest

Sails contract for fixed-reward daily CHIP competition settlement.

## Responsibilities

- hold the native VARA reward pool
- settle previous 12:00 UTC contest windows
- split reward across tied winners deterministically
- transfer payouts immediately during settlement
- persist settled day history for frontend reads

## Notes

- settlement depends on off-chain computed winners from the read model
- this contract stores the final recorded result, not the full replay dataset
- audit linkage is preserved through `result_hash` and `evidence_hash`
- settlement is gated by `day_end_ms(day_id) + grace_period_ms <= now`
- days with no eligible winners are stored as `NoWinner` and do not consume reward pool
- reward split policy is deterministic: winners must be sorted by account, reward is divided evenly, and any remainder is assigned to the first winners in that sorted order
- `fund()` is intentionally public so treasury or external sponsors can top up the pool
- reward-pool reads and command paths mirror the contract account balance via `value_available()`, so direct VARA transfers are usable for settlement and admin withdrawals
- non-funding command routes reject attached value to avoid accidental command-specific deposits

## Admin Operations

The contract keeps `set_config` for full replacement, but also exposes targeted admin routes so the contract does not need to be redeployed for common operations:

- `set_daily_reward`
- `set_grace_period`
- `set_admin_role`
- `set_settler_role`
- `set_roles`
- `withdraw_funds`

`withdraw_funds` syncs against the contract account balance before transferring VARA out. This is intended for treasury rotation or emergency pool management.
