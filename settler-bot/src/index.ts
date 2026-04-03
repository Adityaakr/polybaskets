import 'dotenv/config';
import { BasketMarketVaraClient } from './vara.js';
import { fetchMarketBySlug, fetchMarketById, checkMarketResolution, type PolymarketMarket } from './polymarket.js';

// Hardcoded config (to avoid Railway env var issues)
const VARA_RPC = 'wss://testnet.vara.network';
const PROGRAM_ID = '0x4d47cb784a0b1e3788181a6cedb52db11aad0cef4268848e612670f7d950f089';
const SETTLER_SEED = process.env.SETTLER_SEED?.trim() || 'grocery usual immune burger vote wheat build slot unit lamp client tornado';
const POLL_INTERVAL = 30000;
const SHOULD_FINALIZE = true;

// Initialize Vara client
const varaClient = new BasketMarketVaraClient(PROGRAM_ID, VARA_RPC, SETTLER_SEED);

/**
 * Fetch Polymarket data for all items in a basket
 */
async function fetchBasketItemMarkets(items: Array<{ poly_market_id: string; poly_slug: string }>): Promise<Array<PolymarketMarket | null>> {
  const markets = await Promise.all(
    items.map(async (item) => {
      // Try by ID first, then by slug
      if (item.poly_market_id) {
        const market = await fetchMarketById(item.poly_market_id);
        if (market) return market;
      }
      if (item.poly_slug) {
        return await fetchMarketBySlug(item.poly_slug);
      }
      return null;
    })
  );
  return markets;
}

/**
 * Process a single basket: check if all items are resolved and propose settlement
 */
async function processBasket(basketId: number): Promise<void> {
  const logPrefix = `[Basket ${basketId}]`;
  const timestamp = new Date().toISOString();

  try {
    // Get basket from chain
    const basket = await varaClient.getBasket(basketId);
    if (!basket) {
      console.log(`${timestamp} ${logPrefix} Basket not found, skipping`);
      return;
    }

    // Check if basket is active
    if (basket.status !== 'Active') {
      console.log(`${timestamp} ${logPrefix} Basket status is ${basket.status}, skipping`);
      return;
    }

    // Check if settlement already exists (idempotency)
    const hasSettlement = await varaClient.hasSettlement(basketId);
    if (hasSettlement) {
      console.log(`${timestamp} ${logPrefix} Settlement already exists, skipping`);
      return;
    }

    // Fetch Polymarket data for all items
    console.log(`${timestamp} ${logPrefix} Fetching Polymarket data for ${basket.items.length} items...`);
    const markets = await fetchBasketItemMarkets(basket.items);

    // Check if all items have market data
    const missingMarkets = markets.filter(m => m === null).length;
    if (missingMarkets > 0) {
      console.warn(`${timestamp} ${logPrefix} Missing market data for ${missingMarkets} items, skipping`);
      return;
    }

    // Check if all items are resolved
    const resolutions = markets.map((market, index) => {
      if (!market) {
        return { 
          isResolved: false, 
          resolved: null as 'YES' | 'NO' | null, 
          yesPrice: 0,
          noPrice: 0,
          reason: 'Market data not found' 
        };
      }
      return checkMarketResolution(market);
    });

    const allResolved = resolutions.every(r => r.isResolved && r.resolved !== null);
    if (!allResolved) {
      const resolved = resolutions.filter(r => r.isResolved && r.resolved !== null);
      const unresolved = resolutions.filter(r => !r.isResolved || r.resolved === null);
      
      // Group unresolved by reason for cleaner output
      const unresolvedReasons = new Map<string, number>();
      unresolved.forEach(r => {
        const count = unresolvedReasons.get(r.reason) || 0;
        unresolvedReasons.set(r.reason, count + 1);
      });
      
      const reasonSummary = Array.from(unresolvedReasons.entries())
        .map(([reason, count]) => count > 1 ? `${count}x ${reason}` : reason)
        .join('; ');
      
      console.log(
        `${timestamp} ${logPrefix} Settlement pending: ${resolved.length}/${resolutions.length} resolved, ${unresolved.length}/${resolutions.length} unresolved. Reasons: ${reasonSummary}`
      );
      
      // Show which items are resolved vs unresolved
      const resolvedItems = resolutions
        .map((r, i) => r.isResolved && r.resolved ? `Item ${i}: ${r.resolved}` : null)
        .filter(Boolean);
      
      if (resolvedItems.length > 0) {
        console.log(
          `${timestamp} ${logPrefix}   ✓ Resolved items: ${resolvedItems.join(', ')}`
        );
      }
      
      return;
    }

    // All items are resolved - create item resolutions
    const itemResolutions = basket.items.map((item, index) => {
      const market = markets[index]!;
      const resolution = resolutions[index]!;
      
      if (!resolution.isResolved || !resolution.resolved) {
        throw new Error(`Item ${index} resolution is invalid`);
      }
      
      return {
        item_index: index,
        resolved: resolution.resolved,
        poly_slug: item.poly_slug,
        poly_condition_id: market.id || market.condition_id || null,
        poly_price_yes: Math.floor(resolution.yesPrice * 10000), // Convert to basis points (0-10000)
        poly_price_no: Math.floor(resolution.noPrice * 10000),
      };
    });

    // Create payload (snapshot of Polymarket data for audit)
    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      basket_id: basketId,
      markets: markets.map(m => ({
        id: m?.id,
        slug: m?.slug,
        question: m?.question,
        closed: m?.closed,
        outcomePrices: m?.outcomePrices,
      })),
    });

    // Show resolution summary with detailed prices
    const yesCount = itemResolutions.filter(r => r.resolved === 'YES').length;
    const noCount = itemResolutions.filter(r => r.resolved === 'NO').length;
    
    // Calculate expected settlement index from resolutions
    let settlementIndex = 0;
    basket.items.forEach((item, index) => {
      const resolution = itemResolutions[index];
      if (resolution && resolution.resolved === 'YES') {
        settlementIndex += item.weight_bps / 10000;
      }
    });
    
    console.log(`${timestamp} ${logPrefix} ✅ ALL ${resolutions.length}/${resolutions.length} items resolved! Proposing settlement...`);
    console.log(`${timestamp} ${logPrefix}   Resolution summary: ${yesCount} YES, ${noCount} NO`);
    console.log(`${timestamp} ${logPrefix}   Expected settlement index: ${settlementIndex.toFixed(4)} (${(settlementIndex * 100).toFixed(2)}%)`);
    console.log(`${timestamp} ${logPrefix}   Details:`);
    itemResolutions.forEach((r, i) => {
      const item = basket.items[i];
      const resolution = resolutions[i];
      console.log(`${timestamp} ${logPrefix}     Item ${i} (${(item.weight_bps / 100).toFixed(1)}% weight): ${r.resolved} - YES: ${((resolution.yesPrice || 0) * 100).toFixed(2)}%, NO: ${((resolution.noPrice || 0) * 100).toFixed(2)}%`);
    });

    // Propose settlement
    const txHash = await varaClient.proposeSettlement(basketId, itemResolutions, payload);

    if (txHash) {
      console.log(`${timestamp} ${logPrefix} ✓ Settlement proposed successfully: tx ${txHash}`);
    } else {
      console.error(`${timestamp} ${logPrefix} ✗ Failed to propose settlement (tx returned null)`);
    }
  } catch (error) {
    console.error(`${timestamp} ${logPrefix} Error:`, error);
  }
}

/**
 * Process settlements that can be finalized (after challenge deadline)
 */
async function processSettlements(): Promise<void> {
  if (!SHOULD_FINALIZE) {
    return;
  }

  try {
    // Get contract config to show actual liveness_seconds
    const config = await varaClient.getConfig();
    const livenessMinutes = config ? (config.livenessMs / 60_000).toFixed(0) : 'unknown';
    if (config) {
      console.log(`[processSettlements] Contract liveness_ms: ${config.livenessMs} (${livenessMinutes} minutes challenge period)`);
    }

    const basketCount = await varaClient.getBasketCount();
    // IMPORTANT: Contract timestamps are in MILLISECONDS (from block_timestamp())
    // So we compare in milliseconds, not seconds
    const now = Date.now(); // Current timestamp in milliseconds

    console.log(`[processSettlements] Checking ${basketCount} baskets for finalization (current time: ${now}ms, ${new Date(now).toISOString()})`);

    for (let basketId = 0; basketId < basketCount; basketId++) {
      const settlement = await varaClient.getSettlement(basketId);
      
      if (!settlement) {
        continue; // No settlement for this basket
      }

      // Log settlement details for debugging
      // Contract timestamps are in milliseconds, so use directly
      const proposedDate = new Date(settlement.proposed_at);
      const deadlineDate = new Date(settlement.challenge_deadline);
      const timeUntilDeadline = settlement.challenge_deadline - now;
      const hoursUntilDeadline = timeUntilDeadline / (1000 * 3600); // Convert ms to hours
      const hoursSinceProposal = (now - settlement.proposed_at) / (1000 * 3600); // Convert ms to hours
      
      console.log(`[processSettlements] Basket ${basketId}: status=${settlement.status}`);
      console.log(`  Proposed: ${proposedDate.toISOString()} (${hoursSinceProposal.toFixed(2)}h ago)`);
      console.log(`  Deadline: ${deadlineDate.toISOString()} (${timeUntilDeadline > 0 ? `${hoursUntilDeadline.toFixed(2)}h remaining` : `${Math.abs(hoursUntilDeadline).toFixed(2)}h ago`})`);
      console.log(`  Current: ${new Date(now).toISOString()}`);

      // Check if settlement is in Proposed state and challenge deadline has passed
      // NOTE: Both now and challenge_deadline are in MILLISECONDS
      if (settlement.status === 'Proposed') {
        if (now >= settlement.challenge_deadline) {
          const timestamp = new Date().toISOString();
          const hoursPastDeadline = Math.abs(hoursUntilDeadline);
          console.log(`${timestamp} [Basket ${basketId}] ✓ Challenge deadline passed (${hoursPastDeadline.toFixed(2)}h ago), finalizing settlement...`);
          
          try {
            const txHash = await varaClient.finalizeSettlement(basketId);
            if (txHash) {
              console.log(`${timestamp} [Basket ${basketId}] ✓ Settlement finalized: tx ${txHash}`);
            } else {
              console.error(`${timestamp} [Basket ${basketId}] ✗ Failed to finalize settlement (txHash is null)`);
            }
          } catch (error) {
            console.error(`${timestamp} [Basket ${basketId}] ✗ Error finalizing:`, error);
          }
        } else {
          // Log when deadline hasn't passed yet
          console.log(`[processSettlements] Basket ${basketId}: ⏳ Deadline not yet passed. ${hoursUntilDeadline.toFixed(2)}h remaining until finalization.`);
        }
      } else if (settlement.status === 'Finalized') {
        // finalized_at is also in milliseconds
        const finalizedDate = settlement.finalized_at ? new Date(settlement.finalized_at).toISOString() : 'unknown';
        console.log(`[processSettlements] Basket ${basketId}: ✅ Already finalized at ${finalizedDate}`);
      } else {
        console.log(`[processSettlements] Basket ${basketId}: Status is "${settlement.status}" (not Proposed or Finalized)`);
      }
    }
  } catch (error) {
    console.error('[processSettlements] Error processing settlements:', error);
  }
}

/**
 * Main settler bot loop
 */
async function main() {
  console.log('Starting BasketMarket Settler Bot...');
  console.log(`Vara RPC: ${VARA_RPC}`);
  console.log(`Program ID: ${PROGRAM_ID} (length: ${PROGRAM_ID.length})`);
  console.log(`Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`Finalize enabled: ${SHOULD_FINALIZE}`);
  console.log('');

  await varaClient.waitForReady();
  console.log('Connected to Vara Network');
  console.log('');

  const poll = async () => {
    const timestamp = new Date().toISOString();
    
    try {
      // Ensure connection before polling
      await varaClient.ensureConnected();
      
      const basketCount = await varaClient.getBasketCount();
      console.log(`${timestamp} Polling ${basketCount} baskets...`);

      // Process all baskets
      for (let basketId = 0; basketId < basketCount; basketId++) {
        try {
          await processBasket(basketId);
        } catch (error: any) {
          // If it's a connection error, mark as disconnected and break
          if (error?.message?.includes('disconnected') || error?.message?.includes('Abnormal Closure')) {
            console.warn(`${timestamp} [Basket ${basketId}] Connection lost, will retry on next poll`);
            break;
          }
          console.error(`${timestamp} [Basket ${basketId}] Error processing basket:`, error);
        }
      }

      // Process settlements that can be finalized
      if (SHOULD_FINALIZE) {
        try {
          await processSettlements();
        } catch (error: any) {
          if (error?.message?.includes('disconnected') || error?.message?.includes('Abnormal Closure')) {
            console.warn(`${timestamp} Connection lost during settlement processing, will retry on next poll`);
          } else {
            console.error(`${timestamp} Error processing settlements:`, error);
          }
        }
      }
    } catch (error: any) {
      // Check if it's a connection error
      const errorMessage = error?.message || String(error);
      if (
        errorMessage.includes('disconnected') || 
        errorMessage.includes('Abnormal Closure') || 
        errorMessage.includes('No response') ||
        errorMessage.includes('1006')
      ) {
        console.warn(`${timestamp} ⚠️  Connection issue detected (${errorMessage}), will retry on next poll cycle`);
        // Don't throw - let the interval continue, it will retry
      } else {
        console.error(`${timestamp} ❌ Error in poll cycle:`, error);
        // For non-connection errors, still continue polling
      }
    }
  };

  // Initial poll
  await poll();

  // Set up interval
  const intervalId = setInterval(poll, POLL_INTERVAL);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    clearInterval(intervalId);
    await varaClient.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    clearInterval(intervalId);
    await varaClient.disconnect();
    process.exit(0);
  });
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
