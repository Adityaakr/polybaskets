# TODOS

## BetLane Gas Optimization

### Gas profiling results (baseline)

```
PlaceBet total: 40.5B gas (4.05 VARA at 100 value/gas)

Component breakdown:
  Message routing baseline:         2.2B   (5.4%)
  Payload decode + config read:     2.1B   (5.0%)
  Quote field validation:           14M    (0.0%)
  Schnorrkel signature verify:      71M    (0.2%)   ← NOT a bottleneck
  Cross-program + async overhead:  36.2B   (89.3%)  ← THIS IS THE PROBLEM

Per cross-program round trip: ~12B gas (caller async state machine overhead)
Receiver cost: ~2.3B each (BasketMarket/BetToken processing is cheap)

Current message flow (3 round trips):
  BetLane → BasketMarket: get_basket_status()     ~12B
  BetLane → BetToken: transfer_from()             ~12B
  BetLane → BasketMarket: get_basket_status()     ~12B  (post-transfer recheck)
```

---

### P0 — BetLane Vault + claim_to() (target: ~17-19B funded bets)

**What:** Redesign BetLane as a vault that holds user balances internally. Fund the vault BEFORE betting, then do basket admission AFTER the last await. This eliminates 2 of 3 cross-program round trips on the funded path and safely removes the post-transfer recheck.

**Why:** Cross-program async overhead is 89% of gas. Each round trip costs ~12B in the caller. Reducing from 3 round trips to 1 drops PlaceBet from ~40.5B to ~17-19B for funded bets (55% reduction). With 80 VARA daily voucher budget: ~42-47 bets/day (up from ~20).

**Architecture (Codex-designed, cross-model validated):**

```
FUNDED place_bet (common path — 1 round trip, ~17-19B):
  1. Validate quote signature + fields (local, ~4.3B)
  2. BetLane → BasketMarket.get_basket_status().await  (1 round trip, ~12B)
  3. Check status == Active, asset_kind == Bet
  4. Debit free_balance, credit escrow (local storage write)
  5. Write position (local storage write)
  Done. No token transfer needed — tokens already in vault.

DEFICIT place_bet (first bet after new claim — 2 round trips, ~28-30B):
  1. Check free_balance < amount
  2. BetLane → BetToken.transfer_from(user, lane, deficit).await  (1 round trip)
  3. Credit free_balance with deposited amount
  4. BetLane → BasketMarket.get_basket_status().await  (1 round trip)
  5. Check status, debit/credit, write position (same as funded path)

claim (1 round trip, ~13-15B):
  1. BetLane → BasketMarket.get_settlement_result().await  (1 round trip)
  2. Check finalized, compute payout
  3. Credit payout to free_balance (local write, NO BetToken call)

withdraw (1 round trip):
  1. Debit free_balance
  2. BetLane → BetToken.transfer(user, amount).await  (1 round trip)
```

**Key insight (from Codex):** The post-transfer basket recheck is eliminated safely. In the funded path, there's only ONE await (get_basket_status), and the basket check happens AFTER it. No interleaving between status check and position write. In the deficit path, the token transfer happens FIRST, then the basket check happens LAST. If the basket closed during the transfer await, the status check catches it and refunds from vault balance (local write, no cross-program refund call needed).

**New BetToken method: `claim_to(recipient)`**

Add to `bet-token/app/src/lib.rs`. Same as current `claim()` but mints to `recipient` instead of `msg::source()`. Auth: caller must be the claimer (msg::source), recipient can be any ActorId. This lets agents claim CHIP directly into BetLane vault in one step.

```
Agent daily flow:
  BetToken.claim_to(BetLane)  → CHIP minted directly into vault (1 tx)
  BetLane.place_bet(A, ...)   → funded path, 1 round trip (~17-19B)
  BetLane.place_bet(B, ...)   → funded path, 1 round trip (~17-19B)
  BetLane.place_bet(C, ...)   → funded path, 1 round trip (~17-19B)
  ... basket settles ...
  BetLane.claim(A)            → payout to vault balance (1 round trip, ~13-15B)
  BetLane.place_bet(D, ...)   → funded from payout, 1 round trip (~17-19B)
  BetLane.withdraw(50)        → pull to wallet when done (1 round trip)
```

**Internal accounting (Codex-mandated safety):**

```rust
pub struct UserBalance {
    free: U256,       // available to bet or withdraw
    escrow: U256,     // locked in active positions
}

pub struct BalanceLedger {
    balances: BTreeMap<ActorId, UserBalance>,
}
```

Rules:
- `deposit/claim_to/claim_payout` → credit `free`
- `place_bet` → debit `free`, credit `escrow`
- `claim` (settlement) → compute payout, debit `escrow` by original shares, credit `free` by payout
- `withdraw` → debit `free`, cross-program transfer to user
- Solvency invariant: `sum(all free) + sum(all escrow) <= BetToken.balanceOf(BetLane)`

**User-level locking (Codex-mandated):**

Current locks are per `(basket_id, user)`. With shared balance, concurrent `place_bet(A)` and `place_bet(B)` during awaits can both read the same `free` balance and overspend.

Fix: add `pending_users: BTreeSet<ActorId>` to PendingOperations. Any balance-mutating op (place_bet, claim, withdraw, deposit) inserts the user. If already present, reject with `OperationInProgress`. Clear after the op completes.

**Files to modify:**

| File | Changes |
|------|---------|
| `bet-lane/app/src/lib.rs` | Add `BalanceLedger`, `UserBalance`. Add `deposit()`, `withdraw()`, `balance_of()`. Rewrite `place_bet()` flow (check vault first, auto-deposit on deficit, basket check after last await). Rewrite `claim()` to credit vault. Add user-level locking. |
| `bet-token/app/src/lib.rs` | Add `claim_to(recipient)` method (additive, non-breaking) |
| `bet-lane/tests/bet_lane_gtest.rs` | Add vault tests: deposit, withdraw, funded bet, deficit bet, claim-to-vault, concurrent op rejection, solvency checks |
| `src/components/BetLanePanel.tsx` | Show vault balance, add Withdraw button |
| `src/components/SaveBasketButton.tsx` | Show vault balance |
| `src/pages/ClaimPage.tsx` | Add "Claim to Betting Balance" option |
| Generated IDL/client | Auto-regenerated for both programs |

**Gas savings (agent placing 5 bets/day with claim_to):**

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Daily claim to vault | N/A (new) | ~12B (1 BetToken tx) | — |
| First bet (funded) | ~40.5B | ~17-19B | -53% |
| Bets 2-5 (funded) | ~40.5B each | ~17-19B each | -53% |
| Daily total (5 bets) | 202.5B | ~97-107B | -49-52% |
| Claim payout | ~25B | ~13-15B | -40-48% |

**Effort:** L (1-2 weeks). BetLane rewrite + BetToken additive method + frontend UX for vault balance + tests.

**Depends on:** Nothing external. Can be built as a single PR.

---

### P3 (future V2) — Merge CHIP betting into BasketMarket (target: ~5-8B funded bets)

**What:** Retire BetLane as a stateful program. Move CHIP vault + betting into BasketMarket. Funded bets have ZERO cross-program calls.

**Why:** Even with the P0 vault, funded bets still need 1 round trip to BasketMarket for status check (~12B). If BasketMarket owns both the basket lifecycle AND the CHIP positions, the status check is a local read. Funded PlaceBet drops to ~5-8B gas.

**How:**
- BasketMarket gets `place_bet_chip()`, `claim_chip()`, `withdraw_chip()`, `deposit_chip()`
- Same vault accounting as P0 but inside BasketMarket
- Funded bet: local status check + local balance debit + local position write = zero awaits
- Deficit bet: 1 await (BetToken.transfer_from)
- Claim: fully local (BasketMarket owns settlement data)

**Breaking changes:**
- Quote `target_program_id` changes from BetLane to BasketMarket
- Frontend approve spender changes from BetLane to BasketMarket
- All BetLane PlaceBet/Claim/GetPosition consumers migrate
- Live migration of existing BetLane positions needed
- IDL/client complete regeneration

**Effort:** XL (3-4 weeks). Protocol-level redesign.

**Depends on:** P0 vault shipping first (proves the accounting model). No rush — P0 gets 53% gas reduction already.

---

### P1 — Host-level signature verification (BLOCKED)

**What:** Replace `schnorrkel::verify_simple()` in WASM with a Gear host function.

**Status:** Codex confirmed no `sr25519_verify` wrapper exists in Gear SDK 1.10.x (`gstd`, `gcore`, `gsys`). Blocked until runtime adds it.

**Actual cost (measured):** 71M gas (0.2% of PlaceBet). NOT a bottleneck. The 3-5B estimate was wrong by 50x. Deprioritized.

---

### P2 — Nonce expiry-bucket pruning (saves ~0.2-0.8B now, more over time)

**What:** `used_quote_nonces: BTreeSet<(ActorId, u128)>` grows forever. Every bet adds an entry. With 10K+ bets, serialization cost degrades gas per bet.

**Why:** BTreeSet serialization is O(n). At scale, this becomes a measurable gas regression that compounds with every bet.

**IMPORTANT (Codex finding):** Nonces are **random** (`bet-quote-service/src/quote.ts:62`), NOT monotonic. High-watermark is INVALID.

**How (expiry-bucket pruning):**
Quotes have `deadline_ms` expiry (30 seconds). Nonces only need replay protection until expiry.

1. Replace `BTreeSet<(ActorId, u128)>` with `BTreeMap<u64, BTreeSet<(ActorId, u128)>>` keyed by expiry bucket (round `deadline_ms` to nearest minute)
2. On each `place_bet`, prune expired buckets
3. Storage bounded to `O(active_quotes)` instead of `O(all_bets_ever)`

**Effort:** S. Independent of other changes.

---

## Completed

*None yet*
