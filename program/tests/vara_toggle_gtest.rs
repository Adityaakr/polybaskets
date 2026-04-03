use futures::executor::block_on;
use gtest::System;
use polymarket_mirror::WASM_BINARY;
use polymarket_mirror_client::{
    Basket, BasketAssetKind, BasketItem, BasketMarketConfig, BasketMarketInit, BasketStatus,
    ItemResolution, Outcome, PolymarketMirror, PolymarketMirrorCtors, PolymarketMirrorProgram,
    SettlementStatus, basket_market::BasketMarket,
};
use sails_rs::{
    client::{GtestEnv, Program as _},
    prelude::*,
};

const ADMIN: u64 = 1;
const SETTLER: u64 = 2;
const USER: u64 = 3;
const OTHER_USER: u64 = 4;
const TEST_BALANCE: u128 = 200_000_000_000_000;

struct Harness {
    env: GtestEnv,
    program: sails_rs::client::Actor<PolymarketMirrorProgram, GtestEnv>,
}

impl Harness {
    fn new(liveness_ms: u64) -> Self {
        let system = System::new();
        system.mint_to(ADMIN, TEST_BALANCE);
        system.mint_to(SETTLER, TEST_BALANCE);
        system.mint_to(USER, TEST_BALANCE);
        system.mint_to(OTHER_USER, TEST_BALANCE);
        let code_id = system.submit_code(WASM_BINARY);
        let env = GtestEnv::new(system, ADMIN.into());

        let program = block_on(
            PolymarketMirrorProgram::deploy(code_id, b"toggle-tests".to_vec())
                .with_env(&env)
                .new(BasketMarketInit {
                    admin_role: ADMIN.into(),
                    settler_role: SETTLER.into(),
                    liveness_ms,
                }),
        )
        .expect("program deploy");

        Self { env, program }
    }

    fn advance_blocks(&self, blocks: u32) {
        let next_block = self.env.system().block_height().saturating_add(blocks);
        self.env.system().run_to_block(next_block);
    }

    fn basket_count(&self) -> u64 {
        self.program
            .basket_market()
            .get_basket_count()
            .query()
            .expect("basket count query")
    }

    fn vara_enabled(&self) -> bool {
        self.program
            .basket_market()
            .is_vara_enabled()
            .query()
            .expect("vara flag query")
    }

    fn create_basket(&self, actor: u64, asset_kind: BasketAssetKind, items: Vec<BasketItem>) -> u64 {
        block_on(
            self.program
                .basket_market()
                .create_basket("basket".into(), "basket".into(), items, asset_kind)
                .with_actor_id(actor.into()),
        )
        .expect("create basket transport")
    }

    fn create_basket_fails(
        &self,
        actor: u64,
        name: String,
        description: String,
        asset_kind: BasketAssetKind,
        items: Vec<BasketItem>,
    ) {
        let failed = block_on(
            self.program
                .basket_market()
                .create_basket(name, description, items, asset_kind)
                .with_actor_id(actor.into()),
        )
        .is_err();
        assert!(failed);
    }

    fn propose(&self, actor: u64, basket_id: u64, resolutions: Vec<ItemResolution>) {
        block_on(
            self.program
                .basket_market()
                .propose_settlement(basket_id, resolutions, "payload".into())
                .with_actor_id(actor.into()),
        )
        .expect("propose transport");
    }

    fn propose_fails(&self, actor: u64, basket_id: u64, resolutions: Vec<ItemResolution>, payload: String) {
        let failed = block_on(
            self.program
                .basket_market()
                .propose_settlement(basket_id, resolutions, payload)
                .with_actor_id(actor.into()),
        )
        .is_err();
        assert!(failed);
    }

    fn set_vara_enabled(&self, actor: u64, enabled: bool) {
        block_on(
            self.program
                .basket_market()
                .set_vara_enabled(enabled)
                .with_actor_id(actor.into()),
        )
        .expect("set vara enabled transport");
    }

    fn set_vara_enabled_fails(&self, actor: u64, enabled: bool) {
        let failed = block_on(
            self.program
                .basket_market()
                .set_vara_enabled(enabled)
                .with_actor_id(actor.into()),
        )
        .is_err();
        assert!(failed);
    }
}

fn single_item(outcome: Outcome) -> Vec<BasketItem> {
    vec![BasketItem {
        poly_market_id: "market-1".into(),
        poly_slug: "market-1".into(),
        weight_bps: 10_000,
        selected_outcome: outcome,
    }]
}

fn two_items() -> Vec<BasketItem> {
    vec![
        BasketItem {
            poly_market_id: "market-1".into(),
            poly_slug: "market-1".into(),
            weight_bps: 5_000,
            selected_outcome: Outcome::YES,
        },
        BasketItem {
            poly_market_id: "market-2".into(),
            poly_slug: "market-2".into(),
            weight_bps: 5_000,
            selected_outcome: Outcome::NO,
        },
    ]
}

fn duplicated_items() -> Vec<BasketItem> {
    vec![
        BasketItem {
            poly_market_id: "market-1".into(),
            poly_slug: "market-1".into(),
            weight_bps: 5_000,
            selected_outcome: Outcome::YES,
        },
        BasketItem {
            poly_market_id: "market-1".into(),
            poly_slug: "market-1-duplicate".into(),
            weight_bps: 5_000,
            selected_outcome: Outcome::YES,
        },
    ]
}

fn single_resolution() -> Vec<ItemResolution> {
    vec![ItemResolution {
        item_index: 0,
        resolved: Outcome::YES,
        poly_slug: "market-1".into(),
        poly_condition_id: None,
        poly_price_yes: 10_000,
        poly_price_no: 0,
    }]
}

fn two_resolutions() -> Vec<ItemResolution> {
    vec![
        ItemResolution {
            item_index: 0,
            resolved: Outcome::YES,
            poly_slug: "market-1".into(),
            poly_condition_id: None,
            poly_price_yes: 10_000,
            poly_price_no: 0,
        },
        ItemResolution {
            item_index: 1,
            resolved: Outcome::NO,
            poly_slug: "market-2".into(),
            poly_condition_id: None,
            poly_price_yes: 0,
            poly_price_no: 10_000,
        },
    ]
}

#[test]
fn default_config_is_chip_only() {
    let harness = Harness::new(1_000);

    let config = harness
        .program
        .basket_market()
        .get_config()
        .query()
        .expect("config query");

    assert_eq!(
        config,
        BasketMarketConfig {
            admin_role: ADMIN.into(),
            settler_role: SETTLER.into(),
            liveness_ms: 1_000,
            vara_enabled: false,
        }
    );
    assert!(!harness.vara_enabled());
}

#[test]
fn only_admin_can_toggle_vara_support() {
    let harness = Harness::new(1_000);

    harness.set_vara_enabled_fails(SETTLER, true);
    assert!(!harness.vara_enabled());

    harness.set_vara_enabled_fails(OTHER_USER, true);
    assert!(!harness.vara_enabled());

    harness.set_vara_enabled(ADMIN, true);
    assert!(harness.vara_enabled());
}

#[test]
fn create_basket_respects_vara_toggle() {
    let harness = Harness::new(1_000);

    harness.create_basket_fails(
        USER,
        "basket".into(),
        "basket".into(),
        BasketAssetKind::Vara,
        single_item(Outcome::YES),
    );
    assert_eq!(harness.basket_count(), 0);

    let ft_basket_id = harness.create_basket(USER, BasketAssetKind::Bet, single_item(Outcome::YES));
    assert_eq!(ft_basket_id, 0);

    harness.set_vara_enabled(ADMIN, true);
    let vara_basket_id = harness.create_basket(USER, BasketAssetKind::Vara, single_item(Outcome::YES));
    assert_eq!(vara_basket_id, 1);
}

#[test]
fn duplicate_basket_items_are_rejected_on_chain() {
    let harness = Harness::new(1_000);

    harness.create_basket_fails(
        USER,
        "basket".into(),
        "basket".into(),
        BasketAssetKind::Bet,
        duplicated_items(),
    );
    assert_eq!(harness.basket_count(), 0);
}

#[test]
fn basket_and_payload_size_limits_are_enforced() {
    let harness = Harness::new(1_000);

    harness.create_basket_fails(
        USER,
        "n".repeat(129),
        "description".into(),
        BasketAssetKind::Bet,
        single_item(Outcome::YES),
    );
    assert_eq!(harness.basket_count(), 0);

    let basket_id = harness.create_basket(USER, BasketAssetKind::Bet, single_item(Outcome::YES));
    harness.propose_fails(SETTLER, basket_id, single_resolution(), "p".repeat(4_097));
}

#[test]
fn native_vara_bet_is_rejected_when_disabled_or_for_ft_basket() {
    let harness = Harness::new(1_000);

    harness.set_vara_enabled(ADMIN, true);
    let vara_basket_id = harness.create_basket(USER, BasketAssetKind::Vara, single_item(Outcome::YES));
    let ft_basket_id = harness.create_basket(USER, BasketAssetKind::Bet, single_item(Outcome::YES));

    harness.set_vara_enabled(ADMIN, false);
    let disabled_bet = block_on(
        harness
            .program
            .basket_market()
            .bet_on_basket(vara_basket_id, 10_000)
            .with_actor_id(USER.into())
            .with_value(1_000),
    )
    .is_err();
    assert!(disabled_bet);

    harness.set_vara_enabled(ADMIN, true);
    let ft_native_bet = block_on(
        harness
            .program
            .basket_market()
            .bet_on_basket(ft_basket_id, 10_000)
            .with_actor_id(USER.into())
            .with_value(1_000),
    )
    .is_err();
    assert!(ft_native_bet);
}

#[test]
fn betting_is_locked_after_settlement_proposal() {
    let harness = Harness::new(1_000);

    harness.set_vara_enabled(ADMIN, true);
    let basket_id = harness.create_basket(USER, BasketAssetKind::Vara, single_item(Outcome::YES));
    harness.propose(SETTLER, basket_id, single_resolution());

    let basket: Basket = harness
        .program
        .basket_market()
        .get_basket(basket_id)
        .query()
        .expect("basket query")
        .expect("basket result");
    assert_eq!(basket.status, BasketStatus::SettlementPending);

    let bet_after_proposal = block_on(
        harness
            .program
            .basket_market()
            .bet_on_basket(basket_id, 10_000)
            .with_actor_id(USER.into())
            .with_value(1_000),
    )
    .is_err();
    assert!(bet_after_proposal);
}

#[test]
fn settlement_validation_rejects_duplicate_item_indexes() {
    let harness = Harness::new(1_000);
    let basket_id = harness.create_basket(USER, BasketAssetKind::Bet, two_items());

    let duplicate_indices = vec![
        ItemResolution {
            item_index: 0,
            resolved: Outcome::YES,
            poly_slug: "market-1".into(),
            poly_condition_id: None,
            poly_price_yes: 10_000,
            poly_price_no: 0,
        },
        ItemResolution {
            item_index: 0,
            resolved: Outcome::NO,
            poly_slug: "market-1".into(),
            poly_condition_id: None,
            poly_price_yes: 0,
            poly_price_no: 10_000,
        },
    ];

    harness.propose_fails(SETTLER, basket_id, duplicate_indices, "payload".into());
}

#[test]
fn settlement_validation_rejects_wrong_resolution_count() {
    let harness = Harness::new(1_000);
    let basket_id = harness.create_basket(USER, BasketAssetKind::Bet, two_items());

    harness.propose_fails(SETTLER, basket_id, single_resolution(), "payload".into());
}

#[test]
fn settlement_validation_rejects_slug_mismatch() {
    let harness = Harness::new(1_000);
    let basket_id = harness.create_basket(USER, BasketAssetKind::Bet, two_items());

    let mismatched = vec![
        ItemResolution {
            item_index: 0,
            resolved: Outcome::YES,
            poly_slug: "wrong-slug".into(),
            poly_condition_id: None,
            poly_price_yes: 10_000,
            poly_price_no: 0,
        },
        ItemResolution {
            item_index: 1,
            resolved: Outcome::NO,
            poly_slug: "market-2".into(),
            poly_condition_id: None,
            poly_price_yes: 0,
            poly_price_no: 10_000,
        },
    ];

    harness.propose_fails(SETTLER, basket_id, mismatched, "payload".into());
}

#[test]
fn finalize_before_deadline_is_rejected() {
    let harness = Harness::new(10_000);

    let basket_id = harness.create_basket(USER, BasketAssetKind::Bet, two_items());
    harness.propose(SETTLER, basket_id, two_resolutions());

    let finalize_failed = block_on(
        harness
            .program
            .basket_market()
            .finalize_settlement(basket_id)
            .with_actor_id(USER.into()),
    )
    .is_err();
    assert!(finalize_failed);
}

#[test]
fn claim_requires_finalized_vara_settlement() {
    let harness = Harness::new(1_000);

    harness.set_vara_enabled(ADMIN, true);
    let basket_id = harness.create_basket(USER, BasketAssetKind::Vara, single_item(Outcome::YES));
    let bet = block_on(
        harness
            .program
            .basket_market()
            .bet_on_basket(basket_id, 10_000)
            .with_actor_id(USER.into())
            .with_value(1_000),
    )
    .expect("bet transport");
    assert_eq!(bet, 1_000);

    harness.propose(SETTLER, basket_id, single_resolution());

    let premature_claim = block_on(
        harness
            .program
            .basket_market()
            .claim(basket_id)
            .with_actor_id(USER.into()),
    )
    .is_err();
    assert!(premature_claim);
}

#[test]
fn claim_is_rejected_for_ft_baskets() {
    let harness = Harness::new(1_000);

    let basket_id = harness.create_basket(USER, BasketAssetKind::Bet, single_item(Outcome::YES));
    let claim_failed = block_on(
        harness
            .program
            .basket_market()
            .claim(basket_id)
            .with_actor_id(USER.into()),
    )
    .is_err();
    assert!(claim_failed);
}

#[test]
fn existing_vara_positions_can_claim_after_disable_but_not_twice() {
    let harness = Harness::new(0);

    harness.set_vara_enabled(ADMIN, true);
    let basket_id = harness.create_basket(USER, BasketAssetKind::Vara, single_item(Outcome::YES));
    let bet = block_on(
        harness
            .program
            .basket_market()
            .bet_on_basket(basket_id, 10_000)
            .with_actor_id(USER.into())
            .with_value(1_000),
    )
    .expect("bet transport");
    assert_eq!(bet, 1_000);

    harness.propose(SETTLER, basket_id, single_resolution());
    harness.set_vara_enabled(ADMIN, false);
    harness.advance_blocks(1);

    block_on(
        harness
            .program
            .basket_market()
            .finalize_settlement(basket_id)
            .with_actor_id(OTHER_USER.into()),
    )
    .expect("finalize transport");

    let settlement = harness
        .program
        .basket_market()
        .get_settlement(basket_id)
        .query()
        .expect("settlement query")
        .expect("settlement result");
    assert_eq!(settlement.status, SettlementStatus::Finalized);

    let payout = block_on(
        harness
            .program
            .basket_market()
            .claim(basket_id)
            .with_actor_id(USER.into()),
    )
    .expect("claim transport");
    assert_eq!(payout, 1_000);

    let double_claim_failed = block_on(
        harness
            .program
            .basket_market()
            .claim(basket_id)
            .with_actor_id(USER.into()),
    )
    .is_err();
    assert!(double_claim_failed);
}
