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

### P0 — Merge BetToken + BetLane into one program (saves ~8-10B gas per bet AND per claim, ~1.0-2.0 VARA per cycle)

**What:** `place_bet()` calls BetToken via cross-program `transfer_from()` (~10B gas). `claim()` calls BetToken via cross-program `transfer()` (~10B gas). If the token ledger lives inside BetLane, both become local storage writes (~1-2B gas).

**Why:** This is the single biggest remaining optimization. A full bet cycle (bet + claim) saves ~16-20B gas (~1.6-2.0 VARA). Combined with the status cache above, PlaceBet drops from ~35B to ~15-17B gas (~1.5-1.7 VARA). That's ~53 bets per 80 VARA daily voucher budget instead of ~23.

**How:**
1. Move the VFT (fungible token) logic into BetLane as an internal service
2. BetLane mints/burns tokens internally instead of cross-program transfer
3. Keep BetToken as a standalone program for non-betting token operations (claim CHIP, approve for other contracts)
4. Or: merge completely, BetLane IS the token contract with betting extensions

**Risks:**
- Architecture change affects the entire frontend token flow
- Other contracts that interact with BetToken need updating
- Token approval/allowance model changes
- Audit surface increases (one program does two jobs)

**Effort:** ~1-2 weeks. This is a protocol-level redesign, not a code tweak.

**Depends on:** Decision on whether BetToken needs to exist as a standalone contract for any other purpose (e.g., DEX listing, external integrations, governance).

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
