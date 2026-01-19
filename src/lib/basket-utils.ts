import { BasketItem, Snapshot, Outcome } from '@/types/basket';
import { PolymarketMarket, OutcomeProbabilities } from '@/types/polymarket';
import { getOutcomeProbabilities } from './polymarket';

export function calculateBasketIndex(
  items: BasketItem[],
  marketProbabilities: Map<string, OutcomeProbabilities>
): number {
  let index = 0;
  
  items.forEach(item => {
    const probs = marketProbabilities.get(item.marketId);
    if (probs) {
      const prob = item.outcome === 'YES' ? probs.YES : probs.NO;
      index += (item.weightBps / 10000) * prob;
    }
  });

  return index;
}

export function createSnapshot(
  items: BasketItem[],
  marketProbabilities: Map<string, OutcomeProbabilities>
): Snapshot {
  console.log(`[createSnapshot] Creating snapshot with ${items.length} items, marketProbabilities has ${marketProbabilities.size} entries`);
  
  const components = items.map((item, index) => {
    const probs = marketProbabilities.get(item.marketId);
    const prob = probs ? (item.outcome === 'YES' ? probs.YES : probs.NO) : 0.5;
    
    console.log(`[createSnapshot] Item ${index}: ${item.question?.slice(0, 30)}... - marketId: ${item.marketId}, outcome: ${item.outcome}, prob: ${(prob * 100).toFixed(1)}%, weight: ${(item.weightBps / 100).toFixed(1)}%`, {
      hasProbs: !!probs,
      probsYES: probs?.YES,
      probsNO: probs?.NO,
      selectedProb: prob,
      itemCurrentProb: item.currentProb
    });
    
    return { itemIndex: index, prob };
  });

  const basketIndex = calculateBasketIndex(items, marketProbabilities);
  console.log(`[createSnapshot] Calculated basketIndex: ${basketIndex.toFixed(4)}`);

  return {
    timestamp: Date.now(),
    basketIndex,
    components,
  };
}

export function normalizeWeights(items: BasketItem[]): BasketItem[] {
  if (items.length === 0) return items;

  const totalWeight = items.reduce((sum, item) => sum + item.weightBps, 0);
  
  if (totalWeight === 0) {
    // Equal distribution
    const equalWeight = Math.floor(10000 / items.length);
    const remainder = 10000 - equalWeight * items.length;
    
    return items.map((item, index) => ({
      ...item,
      weightBps: equalWeight + (index < remainder ? 1 : 0),
    }));
  }

  // Scale to 10000
  const scaleFactor = 10000 / totalWeight;
  let normalized = items.map(item => ({
    ...item,
    weightBps: Math.floor(item.weightBps * scaleFactor),
  }));

  // Handle rounding remainder
  const currentTotal = normalized.reduce((sum, item) => sum + item.weightBps, 0);
  const diff = 10000 - currentTotal;
  
  if (diff !== 0 && normalized.length > 0) {
    normalized[0] = {
      ...normalized[0],
      weightBps: normalized[0].weightBps + diff,
    };
  }

  return normalized;
}

export function validateBasket(items: BasketItem[], name: string): string[] {
  const errors: string[] = [];

  if (!name.trim()) {
    errors.push('Basket name is required');
  } else if (name.length > 48) {
    errors.push('Basket name must be 48 characters or less');
  }

  if (items.length === 0) {
    errors.push('Add at least one market to your basket');
  } else if (items.length > 10) {
    errors.push('Maximum 10 items per basket');
  }

  const totalWeight = items.reduce((sum, item) => sum + item.weightBps, 0);
  if (totalWeight !== 10000) {
    errors.push(`Weights must sum to 100% (currently ${(totalWeight / 100).toFixed(1)}%)`);
  }

  // Check for duplicates
  const seen = new Set<string>();
  items.forEach(item => {
    const key = `${item.marketId}-${item.outcome}`;
    if (seen.has(key)) {
      errors.push(`Duplicate entry: ${item.question} (${item.outcome})`);
    }
    seen.add(key);
  });

  return errors;
}

export function formatWeight(weightBps: number): string {
  return `${(weightBps / 100).toFixed(1)}%`;
}

export function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${(change * 100).toFixed(2)}%`;
}

export function getChangeClass(change: number): string {
  if (change > 0) return 'stat-chip-positive';
  if (change < 0) return 'stat-chip-negative';
  return 'stat-chip-neutral';
}

export function truncateAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function createItemFromMarket(
  market: PolymarketMarket,
  outcome: Outcome,
  weightBps: number = 0
): BasketItem {
  const probs = getOutcomeProbabilities(market);
  
  return {
    marketId: market.id,
    slug: market.slug,
    question: market.question,
    outcome,
    weightBps,
    currentProb: outcome === 'YES' ? probs.YES : probs.NO,
  };
}
