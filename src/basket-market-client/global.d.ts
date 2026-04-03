import { ActorId } from 'sails-js';

declare global {
  export interface BasketItem {
    poly_market_id: string;
    poly_slug: string;
    weight_bps: number;
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

  export type BasketStatus = "Active" | "Settled" | "Closed";

  export interface Position {
    basket_id: number | string | bigint;
    user: ActorId;
    shares: number | string | bigint;
    claimed: boolean;
    index_at_creation_bps?: number; // Index at creation in basis points (0-10000), optional for backwards compatibility
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

  export type SettlementStatus = "Proposed" | "Finalized" | "Disputed";
};
