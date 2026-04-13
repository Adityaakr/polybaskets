# TODOS

## BetLane Gas Optimization

### P0 — Local basket status cache (saves ~8-10B gas per repeat bet, ~1.0 VARA)

**What:** BetLane currently queries BasketMarket via cross-program call on every `place_bet()` just to check `basket.status == Active`. This costs ~10B gas per call. Instead, cache basket status locally in BetLane and have the settler update it.

**Why:** Cross-program calls are the dominant gas cost. With 2 calls per `place_bet` at ~10B each, they account for ~60% of total gas. Eliminating one drops PlaceBet from ~35B to ~25B gas (2.5 VARA instead of 3.5 VARA). That's ~40% more bets per VARA of voucher budget.

**How:**
1. Add `BTreeMap<u64, (BasketStatus, BasketAssetKind)>` to BetLane state
2. On first bet for a basket, query BasketMarket and cache the result
3. On repeat bets, read from local cache (skip cross-program call entirely)
4. Add a `notify_basket_status_change(basket_id, new_status)` handler in BetLane
5. Have BasketMarket send a message to BetLane on `propose_settlement` and `finalize_settlement`
6. Update: `program/app/src/lib.rs` (add notification sends), `bet-lane/app/src/lib.rs` (add cache + handler)

**Risks:** Cache coherence. If the notification message fails or is delayed, BetLane has stale status. Mitigation: always allow the cross-program query as fallback, treat cache as optimization hint.

**Depends on:** Settler bot must be aware of the new notification flow (or BasketMarket sends it automatically).

---

### P0 — Internal balance ledger with auto-deposit (saves ~8-10B gas per bet AND per claim, ~1.0-2.0 VARA per cycle)

**What:** `place_bet()` calls BetToken via cross-program `transfer_from()` (~10B gas). `claim()` calls BetToken via cross-program `transfer()` (~10B gas). Add an internal balance ledger to BetLane so tokens stay inside after the first deposit. Subsequent bets and claim payouts are local storage writes (~1-2B gas) with zero cross-program calls.

**Why:** This is the single biggest remaining optimization. A full bet cycle (bet + claim) saves ~16-20B gas (~1.6-2.0 VARA). Combined with the status cache above, PlaceBet drops from ~35B to ~15-17B gas (~1.5-1.7 VARA). That's ~53 bets per 80 VARA daily voucher budget instead of ~23.

**Recommended approach: auto-deposit model (NOT full merge)**

BetToken stays as standalone VFT. BetLane gets an internal `BTreeMap<ActorId, U256>` balance ledger.

**How PlaceBet works with auto-deposit:**
```
place_bet(basket_id, amount, signed_quote):
  1. Check internal BetLane balance for caller
  2. If sufficient → debit internal balance (local write, ~1B gas)
  3. If insufficient → auto-pull deficit from BetToken via transfer_from
     (one cross-program call, ~10B gas, only on first bet after claiming new CHIP)
  4. Rest of place_bet logic unchanged
```

**How Claim works with internal balance:**
```
claim(basket_id):
  1. Compute payout as before
  2. Credit payout to caller's internal balance (local write, ~1B gas)
  3. User can immediately re-bet from internal balance on any basket
  4. User calls withdraw() explicitly when they want tokens back in wallet
```

**New BetLane methods:**
- `deposit(amount)` — explicit deposit from BetToken (optional, auto-deposit covers this)
- `withdraw(amount)` — pull tokens from BetLane back to BetToken/wallet
- `balance_of(user)` — query internal BetLane balance

**Typical agent flow across multiple baskets and days:**
```
Day 1: Claim 100 CHIP → Approve BetLane → PlaceBet on Basket A for 50
        (auto-deposits 50 from BetToken, 1 cross-program call)
        PlaceBet on Basket B for 30 ← uses internal balance (FREE)
        20 CHIP remains in internal balance

Day 2: Claim 100 CHIP → PlaceBet on Basket C for 100
        (auto-deposits 100 from BetToken, 1 cross-program call)
        Basket A settles → Claim payout → 80 CHIP added to internal balance
        PlaceBet on Basket D for 80 ← uses payout balance (FREE)

Day N: Withdraw remaining balance to wallet (1 cross-program call)
```

**Why NOT full merge:**
- BetToken has 19 call sites across 7 frontend files — massive blast radius
- The claim system (daily CHIP, streaks) is independent of betting
- BetToken is a VFT standard — wallets and explorers expect standalone token contracts
- Auto-deposit achieves same gas savings with ~10% of the code change
- BetToken stays unchanged — zero risk to existing token functionality

**Files to modify:**
- `bet-lane/app/src/lib.rs` — add `BalanceLedger` storage, `deposit()`, `withdraw()`, `balance_of()`. Update `place_bet()` to check internal balance first (auto-deposit on deficit). Update `claim()` to credit internal balance.
- `bet-lane/tests/bet_lane_gtest.rs` — add deposit/withdraw/auto-deposit tests, update existing tests
- `src/components/BetLanePanel.tsx` — add withdraw button after claim
- `src/components/SaveBasketButton.tsx` — show BetLane balance, optionally deposit before bet
- Generated IDL/client — auto-regenerated
- BetToken: **NO CHANGES**

**Frontend UX change:**
- For betting: NONE. Auto-deposit is invisible. Same Approve → PlaceBet flow.
- For claiming: payout goes to BetLane internal balance (not wallet). Add a "Withdraw" button to move tokens to wallet when user wants them out.
- New: show "BetLane Balance" alongside "Wallet Balance" in the betting UI.

**Gas savings (agent placing 5 bets/day across different baskets):**

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| First bet of day | ~35B | ~25B | -10B (still 1 cross-program for auto-deposit) |
| Bets 2-5 of day | ~35B each | ~15B each | -20B each (internal balance + cache) |
| Daily total (5 bets) | 175B | 85B | -51% |
| Claim payout | ~25B | ~15B | -10B (internal credit) |

**Effort:** ~3-5 days. Contract changes are contained to BetLane. Frontend needs withdraw UX.

**Depends on:** Decision on how to surface internal balance in the UI (inline vs separate tab).

---

### P1 — Host-level signature verification (savings unknown, needs benchmarking)

**What:** BetLane uses `schnorrkel::PublicKey::verify_simple()` in WASM for quote signature verification (~3-5B gas). Gear/Substrate may expose a host function (`sr25519_verify`) that runs natively instead of in WASM, which would be significantly cheaper.

**Why:** Crypto in WASM is ~10-100x slower than native. If Gear exposes `sr25519_verify` as a syscall, the 3-5B gas cost could drop to ~0.1-0.5B.

**How:**
1. Check Gear SDK docs for available host functions (`gstd::ext` or `gsys`)
2. Benchmark `schnorrkel::verify_simple` in WASM vs a host-level verify
3. If available, replace the WASM verification with the host call
4. If not available, propose it as a Gear runtime feature request

**Risks:** Host function may not exist yet. Gear's gas model may not discount host calls as much as expected.

**Depends on:** Gear runtime capabilities. Check `gstd` and `gsys` crate docs.

---

### P2 — Nonce pruning / high-watermark (saves ~0.2-0.8B now, more over time)

**What:** `used_quote_nonces: BTreeSet<(ActorId, u128)>` grows forever. Every bet adds an entry. With 10K+ bets, serialization cost degrades gas per bet.

**Why:** BTreeSet serialization is O(n). At scale, this becomes a measurable gas regression that compounds with every bet.

**How:** Replace with `BTreeMap<ActorId, u128>` high-watermark if nonces are monotonic. Or add periodic pruning of old nonces if they're random.

**Depends on:** Quote service nonce generation strategy (monotonic vs random).

## Completed

*None yet*
