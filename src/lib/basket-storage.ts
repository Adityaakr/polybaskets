import { Basket, BasketDraft, BasketItem, Snapshot, NetworkType } from '@/types/basket.ts';

const BASKETS_KEY = 'polybaskets_baskets';
const FOLLOWS_KEY = 'polybaskets_follows';
const DRAFT_KEY = 'polybaskets_draft';
const WALLET_KEY = 'polybaskets_wallet';

// Simulated on-chain storage using localStorage
// In production, this would interact with Vara/Gear programs

export function generateBasketId(): string {
  return `basket_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getBaskets(): Basket[] {
  try {
    // Check if localStorage is available
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return [];
    }
    const data = localStorage.getItem(BASKETS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.warn('[basket-storage] Failed to get baskets from localStorage:', error);
    return [];
  }
}

export function getBasketById(id: string): Basket | null {
  try {
    const baskets = getBaskets();
    return baskets.find(b => b.id === id) || null;
  } catch (error) {
    console.warn(`[getBasketById] Failed to get basket ${id}:`, error);
    return null;
  }
}

export function deleteBasket(id: string): boolean {
  try {
    const baskets = getBaskets();
    const initialLength = baskets.length;
    const filtered = baskets.filter(b => b.id !== id);
    
    if (filtered.length < initialLength) {
      localStorage.setItem(BASKETS_KEY, JSON.stringify(filtered));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getBasketsByOwner(owner: string): Basket[] {
  if (!owner) {
    console.warn('[getBasketsByOwner] No owner address provided');
    return [];
  }
  try {
    const baskets = getBaskets();
    const ownerLower = owner.toLowerCase();
    const filtered = baskets.filter(b => {
      const basketOwnerLower = (b.owner || '').toLowerCase();
      const matches = basketOwnerLower === ownerLower;
      if (!matches && b.owner) {
        console.log('[getBasketsByOwner] Mismatch:', { 
          basketOwner: b.owner, 
          basketOwnerLower, 
          searchOwner: owner, 
          searchOwnerLower: ownerLower,
          basketId: b.id,
          basketName: b.name
        });
      }
      return matches;
    });
    console.log(`[getBasketsByOwner] Found ${filtered.length} baskets for owner ${owner} (from ${baskets.length} total)`);
    return filtered;
  } catch (error) {
    console.warn('[getBasketsByOwner] Failed to get baskets by owner:', error);
    return [];
  }
}

export function createBasket(
  draft: BasketDraft,
  owner: string,
  network: NetworkType,
  snapshot: Snapshot
): Basket {
  const baskets = getBaskets();
  
  const newBasket: Basket = {
    id: generateBasketId(),
    owner,
    name: draft.name,
    description: draft.description,
    tags: draft.tags,
    createdAt: Date.now(),
    items: draft.items,
    createdSnapshot: snapshot,
    network,
  };

  baskets.push(newBasket);
  localStorage.setItem(BASKETS_KEY, JSON.stringify(baskets));

  return newBasket;
}

// Follows
export function getFollows(userAddress: string): string[] {
  try {
    // Check if localStorage is available
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return [];
    }
    const data = localStorage.getItem(FOLLOWS_KEY);
    const allFollows: Record<string, string[]> = data ? JSON.parse(data) : {};
    return allFollows[userAddress.toLowerCase()] || [];
  } catch (error) {
    console.warn('[getFollows] Failed to get follows from localStorage:', error);
    return [];
  }
}

export function getFollowerCount(basketId: string): number {
  try {
    const data = localStorage.getItem(FOLLOWS_KEY);
    const allFollows: Record<string, string[]> = data ? JSON.parse(data) : {};
    
    let count = 0;
    Object.values(allFollows).forEach(follows => {
      if (follows.includes(basketId)) count++;
    });
    return count;
  } catch {
    return 0;
  }
}

export function followBasket(userAddress: string, basketId: string): void {
  const data = localStorage.getItem(FOLLOWS_KEY);
  const allFollows: Record<string, string[]> = data ? JSON.parse(data) : {};
  
  const userFollows = allFollows[userAddress.toLowerCase()] || [];
  if (!userFollows.includes(basketId)) {
    userFollows.push(basketId);
    allFollows[userAddress.toLowerCase()] = userFollows;
    localStorage.setItem(FOLLOWS_KEY, JSON.stringify(allFollows));
  }
}

export function unfollowBasket(userAddress: string, basketId: string): void {
  const data = localStorage.getItem(FOLLOWS_KEY);
  const allFollows: Record<string, string[]> = data ? JSON.parse(data) : {};
  
  const userFollows = allFollows[userAddress.toLowerCase()] || [];
  const index = userFollows.indexOf(basketId);
  if (index > -1) {
    userFollows.splice(index, 1);
    allFollows[userAddress.toLowerCase()] = userFollows;
    localStorage.setItem(FOLLOWS_KEY, JSON.stringify(allFollows));
  }
}

export function isFollowing(userAddress: string, basketId: string): boolean {
  const follows = getFollows(userAddress);
  return follows.includes(basketId);
}

// Draft management
export function saveDraft(draft: BasketDraft): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function getDraft(): BasketDraft | null {
  try {
    const data = localStorage.getItem(DRAFT_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}

// Leaderboard
export function getLeaderboardBaskets(limit: number = 10): Array<{
  basket: Basket;
  followerCount: number;
}> {
  const baskets = getBaskets();
  
  return baskets
    .map(basket => ({
      basket,
      followerCount: getFollowerCount(basket.id),
    }))
    .sort((a, b) => b.followerCount - a.followerCount)
    .slice(0, limit);
}

export function getCuratorLeaderboard(limit: number = 10): Array<{
  address: string;
  totalFollowers: number;
  basketCount: number;
}> {
  const baskets = getBaskets();
  
  const curatorMap: Record<string, { totalFollowers: number; basketCount: number }> = {};
  
  baskets.forEach(basket => {
    const owner = basket.owner.toLowerCase();
    const followers = getFollowerCount(basket.id);
    
    if (!curatorMap[owner]) {
      curatorMap[owner] = { totalFollowers: 0, basketCount: 0 };
    }
    
    curatorMap[owner].totalFollowers += followers;
    curatorMap[owner].basketCount += 1;
  });

  return Object.entries(curatorMap)
    .map(([address, stats]) => ({ address, ...stats }))
    .sort((a, b) => b.totalFollowers - a.totalFollowers)
    .slice(0, limit);
}

// Wallet simulation
export function getConnectedWallet(): string | null {
  return localStorage.getItem(WALLET_KEY);
}

export function connectWallet(): string {
  const mockAddress = `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}`;
  localStorage.setItem(WALLET_KEY, mockAddress);
  return mockAddress;
}

export function disconnectWallet(): void {
  localStorage.removeItem(WALLET_KEY);
}
