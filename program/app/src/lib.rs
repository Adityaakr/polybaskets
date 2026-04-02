#![no_std]

use sails_rs::prelude::*;
use parity_scale_codec::{Encode, Decode};
use scale_info::TypeInfo;

// ============================================================================
// Data Structures
// ============================================================================

#[derive(Debug, Clone, Encode, Decode, TypeInfo, PartialEq, Eq)]
pub enum Outcome {
    YES,
    NO,
}

#[derive(Debug, Clone, Encode, Decode, TypeInfo, PartialEq, Eq)]
pub enum BasketStatus {
    Active,
    Settled,
    Closed,
}

#[derive(Debug, Clone, Encode, Decode, TypeInfo, PartialEq, Eq)]
pub enum BasketAssetKind {
    Vara,
    Bet,
}

#[derive(Debug, Clone, Encode, Decode, TypeInfo, PartialEq, Eq)]
pub enum SettlementStatus {
    Proposed,
    Finalized,
    Disputed,
}

#[derive(Debug, Clone, Encode, Decode, TypeInfo)]
pub struct BasketItem {
    pub poly_market_id: String,
    pub poly_slug: String,
    pub weight_bps: u16, // 0-10000 (basis points)
}

#[derive(Debug, Clone, Encode, Decode, TypeInfo)]
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

#[derive(Debug, Clone, Encode, Decode, TypeInfo)]
pub struct Position {
    pub basket_id: u64,
    pub user: ActorId,
    pub shares: u128,
    pub claimed: bool,
    pub index_at_creation_bps: u16, // Index at creation in basis points (0-10000)
}

#[derive(Debug, Clone, Encode, Decode, TypeInfo)]
pub struct ItemResolution {
    pub item_index: u8,
    pub resolved: Outcome,
    pub poly_slug: String,
    pub poly_condition_id: Option<String>,
    pub poly_price_yes: u16, // 0-10000 (basis points)
    pub poly_price_no: u16,  // 0-10000 (basis points)
}

#[derive(Debug, Clone, Encode, Decode, TypeInfo)]
pub struct Settlement {
    pub basket_id: u64,
    pub proposer: ActorId,
    pub item_resolutions: Vec<ItemResolution>,
    pub payout_per_share: u128, // Payout per share in basis points (0-10000)
    pub payload: String,
    pub proposed_at: u64,
    pub challenge_deadline: u64,
    pub finalized_at: Option<u64>,
    pub status: SettlementStatus,
}

#[derive(Debug, Clone, Encode, Decode, TypeInfo)]
pub struct State {
    pub baskets: Vec<Basket>,
    pub positions: Vec<Position>,
    pub settlements: Vec<Settlement>,
    pub next_basket_id: u64,
    pub settler_role: ActorId,
    pub liveness_seconds: u64, // Challenge/finalization delay (e.g., 86400 = 1 day)
}

impl Default for State {
    fn default() -> Self {
        Self {
            baskets: Vec::new(),
            positions: Vec::new(),
            settlements: Vec::new(),
            next_basket_id: 0,
            settler_role: ActorId::zero(),
            liveness_seconds: 86400, // 1 day default
        }
    }
}

// ============================================================================
// Service Implementation
// ============================================================================

struct BasketMarketService<'a> {
    state: &'a mut State,
}

impl<'a> BasketMarketService<'a> {
    pub fn new(state: &'a mut State) -> Self {
        Self { state }
    }

    fn get_basket(&self, basket_id: u64) -> Result<&Basket, String> {
        self.state
            .baskets
            .iter()
            .find(|b| b.id == basket_id)
            .ok_or_else(|| "Basket not found".to_string())
    }

    fn get_basket_mut(&mut self, basket_id: u64) -> Result<&mut Basket, String> {
        self.state
            .baskets
            .iter_mut()
            .find(|b| b.id == basket_id)
            .ok_or_else(|| "Basket not found".to_string())
    }

    fn get_position_mut(&mut self, basket_id: u64, user: ActorId) -> Result<&mut Position, String> {
        self.state
            .positions
            .iter_mut()
            .find(|p| p.basket_id == basket_id && p.user == user)
            .ok_or_else(|| "Position not found".to_string())
    }

    fn get_settlement(&self, basket_id: u64) -> Result<&Settlement, String> {
        self.state
            .settlements
            .iter()
            .find(|s| s.basket_id == basket_id)
            .ok_or_else(|| "Settlement not found".to_string())
    }

    fn get_settlement_mut(&mut self, basket_id: u64) -> Result<&mut Settlement, String> {
        self.state
            .settlements
            .iter_mut()
            .find(|s| s.basket_id == basket_id)
            .ok_or_else(|| "Settlement not found".to_string())
    }

    fn calculate_payout_per_share(
        &self,
        basket: &Basket,
        item_resolutions: &[ItemResolution],
    ) -> Result<u128, String> {
        // Validate resolutions match basket items
        if item_resolutions.len() != basket.items.len() {
            return Err("Item resolutions count does not match basket items".to_string());
        }

        // Calculate basket index: sum(weight_bps * (resolved == YES ? 1.0 : 0.0)) / 10000
        let mut total_weight_value = 0u64;
        
        for resolution in item_resolutions {
            let item = basket.items
                .get(resolution.item_index as usize)
                .ok_or_else(|| "Item index out of bounds".to_string())?;
            
            let resolved_value = if resolution.resolved == Outcome::YES {
                item.weight_bps as u64
            } else {
                0u64
            };
            
            total_weight_value = total_weight_value
                .checked_add(resolved_value)
                .ok_or_else(|| "Weight calculation overflow".to_string())?;
        }

        // payout_per_share = (total_weight_value / 10000) * 10000 (in basis points)
        // Since we're storing in basis points, we can simplify:
        let payout_per_share = total_weight_value as u128;

        Ok(payout_per_share)
    }
}

#[sails_rs::service]
impl<'a> BasketMarketService<'a> {
    #[export]
    pub fn create_basket(
        &mut self,
        name: String,
        description: String,
        items: Vec<BasketItem>,
        asset_kind: BasketAssetKind,
    ) -> Result<u64, String> {
        // Validate items
        if items.is_empty() {
            return Err("Basket must have at least one item".to_string());
        }

        // Validate weights sum to 10000 (or close, allow small rounding differences)
        let total_weight: u32 = items.iter().map(|i| i.weight_bps as u32).sum();
        if total_weight > 10000 {
            return Err("Total weight exceeds 10000 basis points".to_string());
        }

        // Validate all weights are within range
        for item in &items {
            if item.weight_bps > 10000 {
                return Err("Item weight exceeds 10000 basis points".to_string());
            }
        }

        let creator = sails_rs::gstd::msg::source();
        let now = sails_rs::gstd::exec::block_timestamp();

        let basket = Basket {
            id: self.state.next_basket_id,
            creator,
            name,
            description,
            items,
            created_at: now,
            status: BasketStatus::Active,
            asset_kind,
        };

        let basket_id = self.state.next_basket_id;
        self.state.baskets.push(basket);
        self.state.next_basket_id += 1;

        Ok(basket_id)
    }

    #[export]
    pub fn bet_on_basket(&mut self, basket_id: u64, index_at_creation_bps: u16) -> Result<u128, String> {
        let basket = self.get_basket(basket_id)?;
        
        if basket.status != BasketStatus::Active {
            return Err("Basket is not active".to_string());
        }

        let value = sails_rs::gstd::msg::value();
        if value == 0 {
            return Err("Must send value with bet".to_string());
        }

        // Validate index_at_creation_bps is in valid range (1-10000)
        // Minimum of 1 to prevent division by zero in payout calculation
        if index_at_creation_bps == 0 || index_at_creation_bps > 10000 {
            return Err("Index at creation must be between 1 and 10000 basis points".to_string());
        }

        let user = sails_rs::gstd::msg::source();

        // Shares = Amount (1:1 for simplicity)
        let shares = value;

        // Find or create position
        let position = self.state
            .positions
            .iter_mut()
            .find(|p| p.basket_id == basket_id && p.user == user);

        if let Some(pos) = position {
            // Add to existing position - use weighted average for index_at_creation
            // This handles cases where user bets multiple times at different indices
            let old_shares = pos.shares;
            let new_total_shares = old_shares
                .checked_add(shares)
                .ok_or_else(|| "Shares overflow".to_string())?;
            
            // Weighted average: (old_shares * old_index + new_shares * new_index) / total_shares
            let old_weighted_index = (old_shares as u128)
                .checked_mul(pos.index_at_creation_bps as u128)
                .ok_or_else(|| "Index calculation overflow".to_string())?;
            
            let new_weighted_index = (shares as u128)
                .checked_mul(index_at_creation_bps as u128)
                .ok_or_else(|| "Index calculation overflow".to_string())?;
            
            let total_weighted_index = old_weighted_index
                .checked_add(new_weighted_index)
                .ok_or_else(|| "Index calculation overflow".to_string())?;
            
            // Calculate weighted average index (in basis points)
            let avg_index_bps = (total_weighted_index / new_total_shares) as u16;
            
            pos.shares = new_total_shares;
            pos.index_at_creation_bps = avg_index_bps;
        } else {
            // Create new position
            self.state.positions.push(Position {
                basket_id,
                user,
                shares,
                claimed: false,
                index_at_creation_bps,
            });
        }

        Ok(shares)
    }

    #[export]
    pub fn propose_settlement(
        &mut self,
        basket_id: u64,
        item_resolutions: Vec<ItemResolution>,
        payload: String,
    ) -> Result<(), String> {
        // Check caller is settler
        let caller = sails_rs::gstd::msg::source();
        if caller != self.state.settler_role {
            return Err("Only settler can propose settlement".to_string());
        }

        // Validate basket exists and is active
        let basket = self.get_basket(basket_id)?;
        if basket.status != BasketStatus::Active {
            return Err("Basket not active".to_string());
        }

        // Check if settlement already exists
        if self.get_settlement(basket_id).is_ok() {
            return Err("Settlement already exists for this basket".to_string());
        }

        // Validate item resolutions
        if item_resolutions.is_empty() {
            return Err("Item resolutions cannot be empty".to_string());
        }

        if item_resolutions.len() != basket.items.len() {
            return Err("Item resolutions count does not match basket items".to_string());
        }

        // Validate all item indices are valid
        for resolution in &item_resolutions {
            if resolution.item_index as usize >= basket.items.len() {
                return Err("Item index out of bounds".to_string());
            }
        }

        // Calculate payout per share
        let payout_per_share = self.calculate_payout_per_share(&basket, &item_resolutions)?;

        // Create settlement
        let now = sails_rs::gstd::exec::block_timestamp();
        let settlement = Settlement {
            basket_id,
            proposer: caller,
            item_resolutions,
            payout_per_share,
            payload,
            proposed_at: now,
            challenge_deadline: now
                .checked_add(self.state.liveness_seconds)
                .ok_or_else(|| "Challenge deadline overflow".to_string())?,
            finalized_at: None,
            status: SettlementStatus::Proposed,
        };

        self.state.settlements.push(settlement);
        Ok(())
    }

    #[export]
    pub fn finalize_settlement(&mut self, basket_id: u64) -> Result<(), String> {
        let settlement = self.get_settlement_mut(basket_id)?;

        // Check challenge deadline passed
        let now = sails_rs::gstd::exec::block_timestamp();
        if now < settlement.challenge_deadline {
            return Err("Challenge deadline not passed".to_string());
        }

        // Check not already finalized
        if settlement.status != SettlementStatus::Proposed {
            return Err("Settlement not in Proposed state".to_string());
        }

        // Finalize
        settlement.status = SettlementStatus::Finalized;
        settlement.finalized_at = Some(now);

        // Update basket status
        let basket = self.get_basket_mut(basket_id)?;
        basket.status = BasketStatus::Settled;

        Ok(())
    }

    #[export]
    pub fn claim(&mut self, basket_id: u64) -> Result<u128, String> {
        let user = sails_rs::gstd::msg::source();

        // Get FINALIZED settlement first (immutable borrow)
        let settlement = self.get_settlement(basket_id)?;
        
        if settlement.status != SettlementStatus::Finalized {
            return Err("Settlement not finalized".to_string());
        }

        // Settlement index in basis points (0-10000)
        let settlement_index_bps = settlement.payout_per_share;

        // Get user's position (mutable borrow after settlement check)
        let position = self.get_position_mut(basket_id, user)?;
        
        if position.claimed {
            return Err("Already claimed".to_string());
        }

        let shares = position.shares;
        let index_at_creation_bps = position.index_at_creation_bps;

        // Validate index_at_creation_bps to prevent division by zero
        if index_at_creation_bps == 0 {
            return Err("Invalid index at creation: cannot be zero".to_string());
        }

        // Calculate payout using index-based odds system:
        // Payout = Shares × (SettlementIndex / IndexAtCreation)
        // This allows users to profit if settlement index > index at creation
        // Example: Bet 1000 VARA at index 0.421 (42.1%), settle at 1.000 (100%)
        // Payout = 1000 × (10000 / 4210) = 1000 × 2.375 = 2375 VARA (137.5% profit)
        
        // Edge case: If settlement index is 0, user loses everything (all items resolved NO)
        // In this case, payout is 0, which is valid - user gets nothing back
        if settlement_index_bps == 0 {
            // User lost everything, but we still need to mark as claimed
            position.claimed = true;
            // Return 0 instead of error - this is a valid outcome (total loss)
            return Ok(0);
        }
        
        // Calculate: shares * settlement_index_bps / index_at_creation_bps
        // We multiply by 10000 first to maintain precision, then divide by 10000
        // This is equivalent to: shares * (settlement_index_bps / index_at_creation_bps)
        let payout = shares
            .checked_mul(settlement_index_bps as u128)
            .and_then(|x| x.checked_div(index_at_creation_bps as u128))
            .ok_or_else(|| "Payout calculation overflow".to_string())?;

        // Edge case: Payout could be 0 if settlement_index < index_at_creation and shares are small
        // This is a valid outcome (user lost money), but we still transfer 0 and mark as claimed
        if payout == 0 {
            position.claimed = true;
            return Ok(0);
        }

        // Mark as claimed before transfer (prevent re-entrancy)
        position.claimed = true;

        // Transfer payout to user
        // msg::send signature: (destination, payload, value)
        // We send empty payload and payout as the value to transfer
        sails_rs::gstd::msg::send_bytes(user, b"", payout)
            .map_err(|_| "Failed to send payout".to_string())?;

        Ok(payout)
    }

    // ========================================================================
    // Query Functions
    // ========================================================================

    #[export]
    pub fn get_basket(&self, basket_id: u64) -> Result<Basket, String> {
        self.state
            .baskets
            .iter()
            .find(|b| b.id == basket_id)
            .cloned()
            .ok_or_else(|| "Basket not found".to_string())
    }

    #[export]
    pub fn get_positions(&self, user: ActorId) -> Vec<Position> {
        self.state
            .positions
            .iter()
            .filter(|p| p.user == user)
            .cloned()
            .collect()
    }

    #[export]
    pub fn get_settlement(&self, basket_id: u64) -> Result<Settlement, String> {
        self.state
            .settlements
            .iter()
            .find(|s| s.basket_id == basket_id)
            .cloned()
            .ok_or_else(|| "Settlement not found".to_string())
    }

    #[export]
    pub fn get_basket_count(&self) -> u64 {
        self.state.baskets.len() as u64
    }

    #[export]
    pub fn get_config(&self) -> (ActorId, u64) {
        (self.state.settler_role, self.state.liveness_seconds)
    }
}

// ============================================================================
// Program Entry Point
// ============================================================================

pub struct BasketMarketProgram {
    state: State,
}

#[sails_rs::program]
impl BasketMarketProgram {
    // Constructor that accepts init parameters as a tuple
    // Format: (settler_role: ActorId, liveness_seconds: u64)
    pub fn new(settler_role: ActorId, liveness_seconds: u64) -> Self {
        let state = State {
            baskets: Vec::new(),
            positions: Vec::new(),
            settlements: Vec::new(),
            next_basket_id: 0,
            settler_role,
            liveness_seconds,
        };

        Self { state }
    }

    // Exposed service - returns service with mutable reference to program's state
    pub fn basket_market(&mut self) -> BasketMarketService<'_> {
        BasketMarketService::new(&mut self.state)
    }
}
