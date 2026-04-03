import { ActorId } from 'sails-js';

declare global {
  export interface BasketMarketInit {
    admin_role: ActorId;
    settler_role: ActorId;
    liveness_ms: number | string | bigint;
  }

  export interface BasketMarketConfig {
    admin_role: ActorId;
    settler_role: ActorId;
    liveness_ms: number | string | bigint;
    vara_enabled: boolean;
  }

  export type BasketMarketError =
    | "Unauthorized"
    | "BasketNotFound"
    | "BasketNotActive"
    | "BasketAssetMismatch"
    | "NoItems"
    | "InvalidWeights"
    | "DuplicateBasketItem"
    | "TooManyItems"
    | "NameTooLong"
    | "DescriptionTooLong"
    | "MarketIdTooLong"
    | "SlugTooLong"
    | "PayloadTooLong"
    | "VaraDisabled"
    | "SettlementAlreadyExists"
    | "SettlementNotFound"
    | "SettlementNotProposed"
    | "SettlementNotFinalized"
    | "ChallengeDeadlineNotPassed"
    | "InvalidIndexAtCreation"
    | "InvalidBetAmount"
    | "InvalidResolutionCount"
    | "DuplicateResolutionIndex"
    | "ResolutionIndexOutOfBounds"
    | "ResolutionSlugMismatch"
    | "InvalidResolution"
    | "AlreadyClaimed"
    | "NothingToClaim"
    | "TransferFailed"
    | "MathOverflow"
    | "EventEmitFailed"
    | "InvalidConfig";

  export interface BasketItem {
    poly_market_id: string;
    poly_slug: string;
    weight_bps: number;
    selected_outcome: Outcome;
  }

  export interface ItemResolution {
    item_index: number;
    resolved: Outcome;
    poly_slug: string;
    poly_condition_id: string | null;
    poly_price_yes: number;
    poly_price_no: number;
  }

  export type Outcome = "YES" | "NO";

  export interface Basket {
    id: number | string | bigint;
    creator: ActorId;
    name: string;
    description: string;
    items: Array<BasketItem>;
    created_at: number | string | bigint;
    status: BasketStatus;
    asset_kind: BasketAssetKind;
  }

  export type BasketAssetKind = "Vara" | "Bet";

  export type BasketStatus = "Active" | "SettlementPending" | "Settled";

  export interface Position {
    basket_id: number | string | bigint;
    user: ActorId;
    shares: number | string | bigint;
    claimed: boolean;
  }

  export interface Settlement {
    basket_id: number | string | bigint;
    proposer: ActorId;
    item_resolutions: Array<ItemResolution>;
    payout_per_share: number | string | bigint;
    payload: string;
    proposed_at: number | string | bigint;
    challenge_deadline: number | string | bigint;
    finalized_at: number | string | bigint | null;
    status: SettlementStatus;
  }

  export type SettlementStatus = "Proposed" | "Finalized";
};
