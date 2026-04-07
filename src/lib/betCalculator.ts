import { BasketItem } from '@/types/basket.ts';
import { getOutcomePrices } from './polymarket';
import { PolymarketMarket } from '@/types/polymarket.ts';

/**
 * Constant VARA price in USD
 * 1 VARA = $0.0015
 */
export const VARA_PRICE_USD = 0.0015;

/**
 * Convert USD to VARA
 */
export function usdToVara(usd: number): number {
  return usd / VARA_PRICE_USD;
}

/**
 * Convert VARA to USD
 */
export function varaToUsd(vara: number): number {
  return vara * VARA_PRICE_USD;
}

/**
 * Calculate bet allocation per market based on basket weights
 */
export interface MarketBetAllocation {
  marketId: string;
  weightBps: number;
  polymarketPrice: number; // Price in USD for the selected outcome
  usdAmount: number; // USD allocated to this market
  varaAmount: number; // VARA amount for this market
  shares: number; // Number of shares at Polymarket price (USD amount / price)
}

/**
 * Calculate suggested bet amount based on basket composition
 * Suggests a bet amount based on number of markets and total weight
 * 
 * @param items Basket items
 * @returns Suggested VARA amount
 */
export function calculateSuggestedBetAmount(items: BasketItem[]): number {
  if (items.length === 0) {
    return 0;
  }
  
  // Base amount per market: 100 VARA per market
  // This ensures each market gets a meaningful allocation
  const baseAmountPerMarket = 100;
  
  // Calculate based on number of markets
  // More markets = higher suggested amount to ensure meaningful allocations
  const suggestedVara = items.length * baseAmountPerMarket;
  
  // Ensure minimum of 100 VARA, maximum of 10,000 VARA
  return Math.max(100, Math.min(suggestedVara, 10000));
}

/**
 * Calculate allocation from VARA bet amount
 * Allocates VARA to each market based on basket weights
 * 
 * @param totalVaraBet Total bet amount in VARA
 * @param items Basket items with weights
 * @param marketPrices Map of market ID to {YES, NO} prices (optional, for shares calculation)
 * @returns Array of allocations per market and total USD
 */
export function calculateBetAllocationFromVara(
  totalVaraBet: number,
  items: BasketItem[],
  marketPrices?: Map<string, { YES: number; NO: number }>
): {
  allocations: MarketBetAllocation[];
  totalVara: number;
  totalUsd: number;
} {
  const allocations: MarketBetAllocation[] = [];
  const totalUsd = varaToUsd(totalVaraBet);
  
  items.forEach(item => {
    const weightFraction = item.weightBps / 10000; // Convert basis points to fraction
    const varaAmount = totalVaraBet * weightFraction;
    const usdAmount = varaToUsd(varaAmount);
    
    // Calculate shares if market prices are available
    let shares = 0;
    let polymarketPrice = 0;
    if (marketPrices) {
      const prices = marketPrices.get(item.marketId);
      if (prices) {
        polymarketPrice = item.outcome === 'YES' ? prices.YES : prices.NO;
        if (polymarketPrice > 0) {
          shares = usdAmount / polymarketPrice;
        }
      }
    }
    
    allocations.push({
      marketId: item.marketId,
      weightBps: item.weightBps,
      polymarketPrice,
      usdAmount,
      varaAmount,
      shares,
    });
  });
  
  return {
    allocations,
    totalVara: totalVaraBet,
    totalUsd,
  };
}

/**
 * Calculate VARA bet amount needed for a basket based on:
 * - Total USD bet amount
 * - Basket item weights
 * - Polymarket prices for each outcome
 * 
 * @param totalUsdBet Total bet amount in USD
 * @param items Basket items with weights
 * @param marketPrices Map of market ID to {YES, NO} prices
 * @returns Array of allocations per market and total VARA amount
 */
export function calculateBetAllocation(
  totalUsdBet: number,
  items: BasketItem[],
  marketPrices: Map<string, { YES: number; NO: number }>
): {
  allocations: MarketBetAllocation[];
  totalVara: number;
  totalUsd: number;
} {
  const allocations: MarketBetAllocation[] = [];
  
  items.forEach(item => {
    const prices = marketPrices.get(item.marketId);
    if (!prices) {
      // Skip if prices not available
      return;
    }
    
    const polymarketPrice = item.outcome === 'YES' ? prices.YES : prices.NO;
    const weightFraction = item.weightBps / 10000; // Convert basis points to fraction
    const usdAmount = totalUsdBet * weightFraction;
    const shares = usdAmount / polymarketPrice; // Number of shares at Polymarket price
    const varaAmount = usdToVara(usdAmount);
    
    allocations.push({
      marketId: item.marketId,
      weightBps: item.weightBps,
      polymarketPrice,
      usdAmount,
      varaAmount,
      shares,
    });
  });
  
  const totalVara = allocations.reduce((sum, alloc) => sum + alloc.varaAmount, 0);
  const totalUsd = allocations.reduce((sum, alloc) => sum + alloc.usdAmount, 0);
  
  return {
    allocations,
    totalVara,
    totalUsd,
  };
}

/**
 * Calculate required VARA amount for a given USD bet amount on a basket
 * This is the simplified version that just converts USD to VARA
 */
export function calculateRequiredVara(
  totalUsdBet: number,
  items: BasketItem[],
  marketPrices: Map<string, { YES: number; NO: number }>
): number {
  const { totalVara } = calculateBetAllocation(totalUsdBet, items, marketPrices);
  return totalVara;
}

/**
 * Format VARA amount for display
 */
export function formatVara(vara: number): string {
  if (vara >= 1000000) {
    return `${(vara / 1000000).toFixed(2)}M VARA`;
  }
  if (vara >= 1000) {
    return `${(vara / 1000).toFixed(2)}K VARA`;
  }
  return `${vara.toFixed(2)} VARA`;
}

/**
 * Format USD amount for display
 */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
