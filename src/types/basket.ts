export type Outcome = 'YES' | 'NO';

export interface BasketItem {
  marketId: string;
  slug: string;
  question: string;
  outcome: Outcome;
  weightBps: number; // 0-10000 (basis points)
  currentProb?: number; // 0-1
}

export interface Snapshot {
  timestamp: number;
  basketIndex: number; // 0-1
  components: Array<{
    itemIndex: number;
    prob: number;
  }>;
}

export interface Basket {
  id: string;
  owner: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: number;
  items: BasketItem[];
  createdSnapshot: Snapshot;
  network: NetworkType;
  assetKind?: BasketAssetKind;
}

export type BasketAssetKind = 'Vara' | 'FT';

export interface BasketDraft {
  items: BasketItem[];
  name: string;
  description: string;
  tags: string[];
}

export type NetworkType = 'vara' | 'varaeth';

export interface NetworkConfig {
  id: NetworkType;
  name: string;
  rpcUrl: string;
  programId: string;
  explorerBase: string;
}

export interface LeaderboardEntry {
  basketId: string;
  basketName: string;
  owner: string;
  followerCount: number;
  basketIndex: number;
}

export interface CuratorEntry {
  address: string;
  totalFollowers: number;
  basketCount: number;
}
