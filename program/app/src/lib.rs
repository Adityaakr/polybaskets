#![no_std]

use parity_scale_codec::{Decode, Encode};
use sails_rs::prelude::*;
use scale_info::TypeInfo;

const MAX_ITEMS_PER_BASKET: usize = 32;
const MAX_NAME_LEN: usize = 128;
const MAX_AGENT_NAME_LEN: usize = 20;
const MIN_AGENT_NAME_LEN: usize = 3;
const AGENT_RENAME_COOLDOWN_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const MAX_DESCRIPTION_LEN: usize = 512;
const MAX_MARKET_ID_LEN: usize = 128;
const MAX_SLUG_LEN: usize = 128;
const MAX_SETTLEMENT_PAYLOAD_LEN: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Outcome {
    YES,
    NO,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum BasketStatus {
    Active,
    SettlementPending,
    Settled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum BasketAssetKind {
    Vara,
    Bet,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum SettlementStatus {
    Proposed,
    Finalized,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct BasketItem {
    pub poly_market_id: String,
    pub poly_slug: String,
    pub weight_bps: u16,
    pub selected_outcome: Outcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Basket {
    pub id: u64,
    pub creator: ActorId,
    pub name: String,
    pub description: String,
    pub items: Vec<BasketItem>,
    pub created_at: u64,
    pub status: BasketStatus,
    pub asset_kind: BasketAssetKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Position {
    pub basket_id: u64,
    pub user: ActorId,
    pub shares: u128,
    pub claimed: bool,
    pub index_at_creation_bps: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct AgentInfo {
    pub address: ActorId,
    pub name: String,
    pub registered_at: u64,
    pub name_updated_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct ItemResolution {
    pub item_index: u8,
    pub resolved: Outcome,
    pub poly_slug: String,
    pub poly_condition_id: Option<String>,
    pub poly_price_yes: u16,
    pub poly_price_no: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Settlement {
    pub basket_id: u64,
    pub proposer: ActorId,
    pub item_resolutions: Vec<ItemResolution>,
    pub payout_per_share: u128,
    pub payload: String,
    pub proposed_at: u64,
    pub challenge_deadline: u64,
    pub finalized_at: Option<u64>,
    pub status: SettlementStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct BasketMarketInit {
    pub admin_role: ActorId,
    pub settler_role: ActorId,
    pub liveness_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct BasketMarketConfig {
    pub admin_role: ActorId,
    pub settler_role: ActorId,
    pub liveness_ms: u64,
    pub vara_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, TypeInfo, thiserror::Error)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum BasketMarketError {
    #[error("access denied")]
    Unauthorized,
    #[error("basket not found")]
    BasketNotFound,
    #[error("basket is not active")]
    BasketNotActive,
    #[error("basket asset kind does not match this flow")]
    BasketAssetMismatch,
    #[error("basket must have at least one item")]
    NoItems,
    #[error("basket weights must sum to exactly 10000 and each weight must be in range")]
    InvalidWeights,
    #[error("basket contains duplicate market/outcome items")]
    DuplicateBasketItem,
    #[error("basket has too many items")]
    TooManyItems,
    #[error("basket name is too long")]
    NameTooLong,
    #[error("basket description is too long")]
    DescriptionTooLong,
    #[error("market id is too long")]
    MarketIdTooLong,
    #[error("slug is too long")]
    SlugTooLong,
    #[error("settlement payload is too long")]
    PayloadTooLong,
    #[error("vara support is disabled")]
    VaraDisabled,
    #[error("settlement already exists")]
    SettlementAlreadyExists,
    #[error("settlement not found")]
    SettlementNotFound,
    #[error("settlement is not proposed")]
    SettlementNotProposed,
    #[error("settlement is not finalized")]
    SettlementNotFinalized,
    #[error("challenge deadline not passed")]
    ChallengeDeadlineNotPassed,
    #[error("index at creation must be between 1 and 10000")]
    InvalidIndexAtCreation,
    #[error("bet amount must be greater than zero")]
    InvalidBetAmount,
    #[error("item resolutions count does not match basket items")]
    InvalidResolutionCount,
    #[error("duplicate item_index in settlement resolutions")]
    DuplicateResolutionIndex,
    #[error("resolution item_index is out of bounds")]
    ResolutionIndexOutOfBounds,
    #[error("resolution slug does not match basket item")]
    ResolutionSlugMismatch,
    #[error("resolution price values must be within 0..=10000")]
    InvalidResolution,
    #[error("already claimed")]
    AlreadyClaimed,
    #[error("nothing to claim")]
    NothingToClaim,
    #[error("native payout transfer failed")]
    TransferFailed,
    #[error("math overflow")]
    MathOverflow,
    #[error("event emission failed")]
    EventEmitFailed,
    #[error("invalid config")]
    InvalidConfig,
    #[error("agent name too short")]
    AgentNameTooShort,
    #[error("agent name too long")]
    AgentNameTooLong,
    #[error("agent name invalid")]
    AgentNameInvalid,
    #[error("agent name taken")]
    AgentNameTaken,
    #[error("rename cooldown active")]
    AgentRenameCooldown,
}

#[event]
#[derive(Clone, Debug, PartialEq, Eq, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum Event {
    BasketCreated {
        basket_id: u64,
        creator: ActorId,
        asset_kind: BasketAssetKind,
    },
    VaraBetPlaced {
        basket_id: u64,
        user: ActorId,
        amount: u128,
        user_total: u128,
        index_at_creation_bps: u16,
    },
    SettlementProposed {
        basket_id: u64,
        asset_kind: BasketAssetKind,
        proposer: ActorId,
        payout_per_share: u128,
        challenge_deadline: u64,
    },
    SettlementFinalized {
        basket_id: u64,
        asset_kind: BasketAssetKind,
        finalized_at: u64,
        payout_per_share: u128,
    },
    Claimed {
        basket_id: u64,
        user: ActorId,
        amount: u128,
    },
    AgentRegistered {
        agent: ActorId,
        name: String,
    },
    AgentRenamed {
        agent: ActorId,
        old_name: String,
        new_name: String,
    },
    VaraSupportUpdated {
        enabled: bool,
    },
    ConfigUpdated {
        config: BasketMarketConfig,
    },
}

#[derive(Debug, Clone, Encode, Decode, TypeInfo)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct State {
    pub baskets: Vec<Basket>,
    pub positions: Vec<Position>,
    pub settlements: Vec<Settlement>,
    pub agents: Vec<AgentInfo>,
    pub next_basket_id: u64,
    pub config: BasketMarketConfig,
}

impl Default for State {
    fn default() -> Self {
        Self {
            baskets: Vec::new(),
            positions: Vec::new(),
            settlements: Vec::new(),
            agents: Vec::new(),
            next_basket_id: 0,
            config: BasketMarketConfig {
                admin_role: ActorId::zero(),
                settler_role: ActorId::zero(),
                liveness_ms: 86_400_000,
                vara_enabled: false,
            },
        }
    }
}

struct BasketMarketService<'a> {
    state: &'a mut State,
}

impl<'a> BasketMarketService<'a> {
    pub fn new(state: &'a mut State) -> Self {
        Self { state }
    }

    fn basket_index(&self, basket_id: u64) -> Result<usize, BasketMarketError> {
        self.state
            .baskets
            .iter()
            .position(|basket| basket.id == basket_id)
            .ok_or(BasketMarketError::BasketNotFound)
    }

    fn settlement_index(&self, basket_id: u64) -> Result<usize, BasketMarketError> {
        self.state
            .settlements
            .iter()
            .position(|settlement| settlement.basket_id == basket_id)
            .ok_or(BasketMarketError::SettlementNotFound)
    }

    fn position_index(&self, basket_id: u64, user: ActorId) -> Option<usize> {
        self.state
            .positions
            .iter()
            .position(|position| position.basket_id == basket_id && position.user == user)
    }

    fn ensure_admin(&self) -> Result<(), BasketMarketError> {
        if sails_rs::gstd::msg::source() != self.state.config.admin_role {
            return Err(BasketMarketError::Unauthorized);
        }

        Ok(())
    }

    fn ensure_settler(&self) -> Result<(), BasketMarketError> {
        if sails_rs::gstd::msg::source() != self.state.config.settler_role {
            return Err(BasketMarketError::Unauthorized);
        }

        Ok(())
    }

    fn validate_config(config: &BasketMarketConfig) -> Result<(), BasketMarketError> {
        if config.admin_role == ActorId::zero() || config.settler_role == ActorId::zero() {
            return Err(BasketMarketError::InvalidConfig);
        }

        Ok(())
    }

    fn validate_items(items: &[BasketItem]) -> Result<(), BasketMarketError> {
        if items.is_empty() {
            return Err(BasketMarketError::NoItems);
        }
        if items.len() > MAX_ITEMS_PER_BASKET {
            return Err(BasketMarketError::TooManyItems);
        }

        let mut total_weight = 0u32;
        for (index, item) in items.iter().enumerate() {
            if item.weight_bps == 0 || item.weight_bps > 10_000 {
                return Err(BasketMarketError::InvalidWeights);
            }
            if item.poly_market_id.len() > MAX_MARKET_ID_LEN {
                return Err(BasketMarketError::MarketIdTooLong);
            }
            if item.poly_slug.len() > MAX_SLUG_LEN {
                return Err(BasketMarketError::SlugTooLong);
            }
            if items
                .iter()
                .skip(index + 1)
                .any(|other| {
                    other.poly_market_id == item.poly_market_id
                        && other.selected_outcome == item.selected_outcome
                })
            {
                return Err(BasketMarketError::DuplicateBasketItem);
            }

            total_weight = total_weight
                .checked_add(item.weight_bps as u32)
                .ok_or(BasketMarketError::MathOverflow)?;
        }

        if total_weight != 10_000 {
            return Err(BasketMarketError::InvalidWeights);
        }

        Ok(())
    }

    fn validate_index_at_creation(index_at_creation_bps: u16) -> Result<(), BasketMarketError> {
        if !(1..=10_000).contains(&index_at_creation_bps) {
            return Err(BasketMarketError::InvalidIndexAtCreation);
        }

        Ok(())
    }

    fn agent_index(&self, address: ActorId) -> Option<usize> {
        self.state.agents.iter().position(|a| a.address == address)
    }

    fn is_agent_name_taken(&self, name: &str, exclude: Option<ActorId>) -> bool {
        self.state.agents.iter().any(|a| {
            a.name == name && exclude.map_or(true, |ex| a.address != ex)
        })
    }

    fn validate_agent_name(name: &str) -> Result<(), BasketMarketError> {
        if name.len() < MIN_AGENT_NAME_LEN {
            return Err(BasketMarketError::AgentNameTooShort);
        }
        if name.len() > MAX_AGENT_NAME_LEN {
            return Err(BasketMarketError::AgentNameTooLong);
        }
        let bytes = name.as_bytes();
        if bytes[0] == b'-' || bytes[bytes.len() - 1] == b'-' {
            return Err(BasketMarketError::AgentNameInvalid);
        }
        for &b in bytes {
            if !(b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
                return Err(BasketMarketError::AgentNameInvalid);
            }
        }
        Ok(())
    }

    fn validate_basket_metadata(
        name: &str,
        description: &str,
    ) -> Result<(), BasketMarketError> {
        if name.len() > MAX_NAME_LEN {
            return Err(BasketMarketError::NameTooLong);
        }
        if description.len() > MAX_DESCRIPTION_LEN {
            return Err(BasketMarketError::DescriptionTooLong);
        }

        Ok(())
    }

    fn validate_resolution_prices(
        resolution: &ItemResolution,
    ) -> Result<(), BasketMarketError> {
        if resolution.poly_price_yes > 10_000 || resolution.poly_price_no > 10_000 {
            return Err(BasketMarketError::InvalidResolution);
        }

        Ok(())
    }

    fn calculate_payout_per_share(
        basket: &Basket,
        item_resolutions: &[ItemResolution],
    ) -> Result<u128, BasketMarketError> {
        if item_resolutions.len() != basket.items.len() {
            return Err(BasketMarketError::InvalidResolutionCount);
        }

        let mut seen = vec![false; basket.items.len()];
        let mut total_weight_value = 0u64;

        for resolution in item_resolutions {
            Self::validate_resolution_prices(resolution)?;

            let item_index = resolution.item_index as usize;
            let item = basket
                .items
                .get(item_index)
                .ok_or(BasketMarketError::ResolutionIndexOutOfBounds)?;

            if seen[item_index] {
                return Err(BasketMarketError::DuplicateResolutionIndex);
            }
            seen[item_index] = true;

            if resolution.poly_slug != item.poly_slug {
                return Err(BasketMarketError::ResolutionSlugMismatch);
            }

            let resolved_value = if resolution.resolved == item.selected_outcome {
                item.weight_bps as u64
            } else {
                0
            };

            total_weight_value = total_weight_value
                .checked_add(resolved_value)
                .ok_or(BasketMarketError::MathOverflow)?;
        }

        if seen.iter().any(|covered| !covered) {
            return Err(BasketMarketError::InvalidResolutionCount);
        }

        Ok(total_weight_value as u128)
    }
}

#[sails_rs::service(events = Event)]
impl<'a> BasketMarketService<'a> {
    #[export(unwrap_result)]
    pub fn create_basket(
        &mut self,
        name: String,
        description: String,
        items: Vec<BasketItem>,
        asset_kind: BasketAssetKind,
    ) -> Result<u64, BasketMarketError> {
        BasketMarketService::validate_basket_metadata(&name, &description)?;
        BasketMarketService::validate_items(&items)?;

        if asset_kind == BasketAssetKind::Vara && !self.state.config.vara_enabled {
            return Err(BasketMarketError::VaraDisabled);
        }

        let creator = sails_rs::gstd::msg::source();
        let created_at = sails_rs::gstd::exec::block_timestamp();
        let basket_id = self.state.next_basket_id;

        self.state.baskets.push(Basket {
            id: basket_id,
            creator,
            name,
            description,
            items,
            created_at,
            status: BasketStatus::Active,
            asset_kind,
        });
        self.state.next_basket_id = self
            .state
            .next_basket_id
            .checked_add(1)
            .ok_or(BasketMarketError::MathOverflow)?;

        self.emit_event(Event::BasketCreated {
            basket_id,
            creator,
            asset_kind,
        })
        .map_err(|_| BasketMarketError::EventEmitFailed)?;

        Ok(basket_id)
    }

    #[export(unwrap_result)]
    pub fn bet_on_basket(
        &mut self,
        basket_id: u64,
        index_at_creation_bps: u16,
    ) -> Result<u128, BasketMarketError> {
        let basket_index = self.basket_index(basket_id)?;
        let basket = &self.state.baskets[basket_index];

        if basket.asset_kind != BasketAssetKind::Vara {
            return Err(BasketMarketError::BasketAssetMismatch);
        }
        if !self.state.config.vara_enabled {
            return Err(BasketMarketError::VaraDisabled);
        }
        if basket.status != BasketStatus::Active {
            return Err(BasketMarketError::BasketNotActive);
        }

        let value = sails_rs::gstd::msg::value();
        if value == 0 {
            return Err(BasketMarketError::InvalidBetAmount);
        }
        BasketMarketService::validate_index_at_creation(index_at_creation_bps)?;

        let user = sails_rs::gstd::msg::source();
        let shares = value;
        let user_total;
        let stored_index_at_creation_bps;

        if let Some(position_index) =
            self.position_index(basket_id, user)
        {
            let position = &mut self.state.positions[position_index];
            let old_shares = position.shares;
            user_total = old_shares
                .checked_add(shares)
                .ok_or(BasketMarketError::MathOverflow)?;

            let old_weighted_index = old_shares
                .checked_mul(position.index_at_creation_bps as u128)
                .ok_or(BasketMarketError::MathOverflow)?;
            let new_weighted_index = shares
                .checked_mul(index_at_creation_bps as u128)
                .ok_or(BasketMarketError::MathOverflow)?;
            let total_weighted_index = old_weighted_index
                .checked_add(new_weighted_index)
                .ok_or(BasketMarketError::MathOverflow)?;
            let average_index = total_weighted_index
                .checked_div(user_total)
                .ok_or(BasketMarketError::MathOverflow)?;
            stored_index_at_creation_bps =
                u16::try_from(average_index).map_err(|_| BasketMarketError::MathOverflow)?;

            position.shares = user_total;
            position.index_at_creation_bps = stored_index_at_creation_bps;
        } else {
            self.state.positions.push(Position {
                basket_id,
                user,
                shares,
                claimed: false,
                index_at_creation_bps,
            });
            user_total = shares;
            stored_index_at_creation_bps = index_at_creation_bps;
        };

        self.emit_event(Event::VaraBetPlaced {
            basket_id,
            user,
            amount: shares,
            user_total,
            index_at_creation_bps: stored_index_at_creation_bps,
        })
        .map_err(|_| BasketMarketError::EventEmitFailed)?;

        Ok(shares)
    }

    #[export(unwrap_result)]
    pub fn propose_settlement(
        &mut self,
        basket_id: u64,
        item_resolutions: Vec<ItemResolution>,
        payload: String,
    ) -> Result<(), BasketMarketError> {
        self.ensure_settler()?;
        if payload.len() > MAX_SETTLEMENT_PAYLOAD_LEN {
            return Err(BasketMarketError::PayloadTooLong);
        }

        let basket_index = self.basket_index(basket_id)?;
        let basket = &self.state.baskets[basket_index];
        if basket.status != BasketStatus::Active {
            return Err(BasketMarketError::BasketNotActive);
        }
        let asset_kind = basket.asset_kind;

        if self.settlement_index(basket_id).is_ok() {
            return Err(BasketMarketError::SettlementAlreadyExists);
        }

        let payout_per_share =
            BasketMarketService::calculate_payout_per_share(basket, &item_resolutions)?;
        let proposed_at = sails_rs::gstd::exec::block_timestamp();
        let challenge_deadline = proposed_at
            .checked_add(self.state.config.liveness_ms)
            .ok_or(BasketMarketError::MathOverflow)?;
        let proposer = sails_rs::gstd::msg::source();

        self.state.settlements.push(Settlement {
            basket_id,
            proposer,
            item_resolutions,
            payout_per_share,
            payload,
            proposed_at,
            challenge_deadline,
            finalized_at: None,
            status: SettlementStatus::Proposed,
        });
        self.state.baskets[basket_index].status = BasketStatus::SettlementPending;

        self.emit_event(Event::SettlementProposed {
            basket_id,
            asset_kind,
            proposer,
            payout_per_share,
            challenge_deadline,
        })
        .map_err(|_| BasketMarketError::EventEmitFailed)?;

        Ok(())
    }

    #[export(unwrap_result)]
    pub fn finalize_settlement(&mut self, basket_id: u64) -> Result<(), BasketMarketError> {
        let settlement_index = self.settlement_index(basket_id)?;
        let now = sails_rs::gstd::exec::block_timestamp();
        let payout_per_share = {
            let settlement = &mut self.state.settlements[settlement_index];

            if settlement.status != SettlementStatus::Proposed {
                return Err(BasketMarketError::SettlementNotProposed);
            }
            if now < settlement.challenge_deadline {
                return Err(BasketMarketError::ChallengeDeadlineNotPassed);
            }

            settlement.status = SettlementStatus::Finalized;
            settlement.finalized_at = Some(now);
            settlement.payout_per_share
        };

        let basket_index = self.basket_index(basket_id)?;
        self.state.baskets[basket_index].status = BasketStatus::Settled;

        self.emit_event(Event::SettlementFinalized {
            basket_id,
            asset_kind: self.state.baskets[basket_index].asset_kind,
            finalized_at: now,
            payout_per_share,
        })
        .map_err(|_| BasketMarketError::EventEmitFailed)?;

        Ok(())
    }

    #[export(unwrap_result)]
    pub fn claim(&mut self, basket_id: u64) -> Result<u128, BasketMarketError> {
        let basket_index = self.basket_index(basket_id)?;
        let basket = &self.state.baskets[basket_index];
        if basket.asset_kind != BasketAssetKind::Vara {
            return Err(BasketMarketError::BasketAssetMismatch);
        }

        let settlement_index = self.settlement_index(basket_id)?;
        let settlement = &self.state.settlements[settlement_index];
        if settlement.status != SettlementStatus::Finalized {
            return Err(BasketMarketError::SettlementNotFinalized);
        }

        let user = sails_rs::gstd::msg::source();
        let position_index = self
            .position_index(basket_id, user)
            .ok_or(BasketMarketError::NothingToClaim)?;
        let position = &self.state.positions[position_index];

        if position.claimed {
            return Err(BasketMarketError::AlreadyClaimed);
        }
        BasketMarketService::validate_index_at_creation(position.index_at_creation_bps)?;

        let payout = if settlement.payout_per_share == 0 {
            0
        } else {
            position
                .shares
                .checked_mul(settlement.payout_per_share)
                .and_then(|value| value.checked_div(position.index_at_creation_bps as u128))
                .ok_or(BasketMarketError::MathOverflow)?
        };

        if payout > 0 {
            sails_rs::gstd::msg::send_bytes(user, b"", payout)
                .map_err(|_| BasketMarketError::TransferFailed)?;
        }

        self.state.positions[position_index].claimed = true;
        self.emit_event(Event::Claimed {
            basket_id,
            user,
            amount: payout,
        })
        .map_err(|_| BasketMarketError::EventEmitFailed)?;

        Ok(payout)
    }

    /// Register an agent with a display name, or rename if already registered.
    /// Input is normalized to lowercase. Names must be 3-20 chars, alphanumeric
    /// and hyphens only, no leading/trailing hyphens. Rename has a 7-day cooldown.
    #[export(unwrap_result)]
    pub fn register_agent(&mut self, name: String) -> Result<(), BasketMarketError> {
        let name = name.to_ascii_lowercase();
        BasketMarketService::validate_agent_name(&name)?;

        let caller = sails_rs::gstd::msg::source();
        let now = sails_rs::gstd::exec::block_timestamp();

        if let Some(idx) = self.agent_index(caller) {
            let agent = &self.state.agents[idx];
            // No-op if renaming to the same name
            if agent.name == name {
                return Ok(());
            }
            if now < agent.name_updated_at + AGENT_RENAME_COOLDOWN_MS {
                return Err(BasketMarketError::AgentRenameCooldown);
            }
            if self.is_agent_name_taken(&name, Some(caller)) {
                return Err(BasketMarketError::AgentNameTaken);
            }
            let old_name = self.state.agents[idx].name.clone();
            self.state.agents[idx].name = name.clone();
            self.state.agents[idx].name_updated_at = now;
            self.emit_event(Event::AgentRenamed {
                agent: caller,
                old_name,
                new_name: name,
            })
            .map_err(|_| BasketMarketError::EventEmitFailed)?;
        } else {
            if self.is_agent_name_taken(&name, None) {
                return Err(BasketMarketError::AgentNameTaken);
            }
            self.state.agents.push(AgentInfo {
                address: caller,
                name: name.clone(),
                registered_at: now,
                name_updated_at: now,
            });
            self.emit_event(Event::AgentRegistered {
                agent: caller,
                name,
            })
            .map_err(|_| BasketMarketError::EventEmitFailed)?;
        }

        Ok(())
    }

    #[export]
    pub fn get_agent(&self, address: ActorId) -> Option<AgentInfo> {
        self.state.agents.iter().find(|a| a.address == address).cloned()
    }

    #[export]
    pub fn get_all_agents(&self) -> Vec<AgentInfo> {
        self.state.agents.clone()
    }

    #[export]
    pub fn get_agent_count(&self) -> u64 {
        self.state.agents.len() as u64
    }

    #[export]
    pub fn get_basket(&self, basket_id: u64) -> Result<Basket, BasketMarketError> {
        let basket_index = self.basket_index(basket_id)?;
        Ok(self.state.baskets[basket_index].clone())
    }

    #[export]
    pub fn get_positions(&self, user: ActorId) -> Vec<Position> {
        self.state
            .positions
            .iter()
            .filter(|position| position.user == user)
            .cloned()
            .collect()
    }

    #[export]
    pub fn get_settlement(&self, basket_id: u64) -> Result<Settlement, BasketMarketError> {
        let settlement_index = self.settlement_index(basket_id)?;
        Ok(self.state.settlements[settlement_index].clone())
    }

    #[export]
    pub fn get_basket_count(&self) -> u64 {
        self.state.baskets.len() as u64
    }

    #[export]
    pub fn get_config(&self) -> BasketMarketConfig {
        self.state.config.clone()
    }

    #[export]
    pub fn is_vara_enabled(&self) -> bool {
        self.state.config.vara_enabled
    }

    #[export(unwrap_result)]
    pub fn set_vara_enabled(&mut self, enabled: bool) -> Result<(), BasketMarketError> {
        self.ensure_admin()?;
        self.state.config.vara_enabled = enabled;
        self.emit_event(Event::VaraSupportUpdated { enabled })
            .map_err(|_| BasketMarketError::EventEmitFailed)?;
        Ok(())
    }

    #[export(unwrap_result)]
    pub fn set_config(&mut self, config: BasketMarketConfig) -> Result<(), BasketMarketError> {
        self.ensure_admin()?;
        BasketMarketService::validate_config(&config)?;

        let vara_enabled_changed = self.state.config.vara_enabled != config.vara_enabled;
        self.state.config = config.clone();

        self.emit_event(Event::ConfigUpdated {
            config: config.clone(),
        })
        .map_err(|_| BasketMarketError::EventEmitFailed)?;

        if vara_enabled_changed {
            self.emit_event(Event::VaraSupportUpdated {
                enabled: config.vara_enabled,
            })
            .map_err(|_| BasketMarketError::EventEmitFailed)?;
        }

        Ok(())
    }
}

pub struct BasketMarketProgram {
    state: State,
}

#[sails_rs::program]
impl BasketMarketProgram {
    pub fn new(init: BasketMarketInit) -> Self {
        BasketMarketService::validate_config(&BasketMarketConfig {
            admin_role: init.admin_role,
            settler_role: init.settler_role,
            liveness_ms: init.liveness_ms,
            vara_enabled: false,
        })
        .expect("invalid initial config");

        Self {
            state: State {
                baskets: Vec::new(),
                positions: Vec::new(),
                settlements: Vec::new(),
                agents: Vec::new(),
                next_basket_id: 0,
                config: BasketMarketConfig {
                    admin_role: init.admin_role,
                    settler_role: init.settler_role,
                    liveness_ms: init.liveness_ms,
                    vara_enabled: false,
                },
            },
        }
    }

    pub fn basket_market(&mut self) -> BasketMarketService<'_> {
        BasketMarketService::new(&mut self.state)
    }
}
