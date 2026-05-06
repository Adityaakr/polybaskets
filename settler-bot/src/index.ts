import { BasketMarketVaraClient, getErrorMessage, isRetryableVaraError } from './vara.js';
import { fetchMarketBySlug, fetchMarketById, checkMarketResolution, type PolymarketMarket } from './polymarket.js';
import { config } from './config.js';

// Initialize Vara client
const varaClient = new BasketMarketVaraClient(
  config.basketMarketProgramId,
  config.varaRpcUrl,
  config.settlerSeed,
);

function takeBasketBatch(start: number, count: number, size: number): { ids: number[]; next: number } {
  if (count <= 0) {
    return { ids: [], next: 0 };
  }

  const safeStart = start >= 0 && start < count ? start : 0;
  const batchSize = Math.min(size, count);
  const ids = Array.from({ length: batchSize }, (_, index) => (safeStart + index) % count);
  return { ids, next: (safeStart + batchSize) % count };
}

process.on('unhandledRejection', (reason) => {
  if (isRetryableVaraError(reason)) {
    console.warn(`⚠️  Unhandled Vara RPC disconnect: ${getErrorMessage(reason)}. Reconnecting...`);
    void varaClient.forceReconnect().catch((error) => {
      console.error('❌ Failed to reconnect after unhandled Vara RPC disconnect:', error);
    });
    return;
  }

  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  if (isRetryableVaraError(error)) {
    console.warn(`⚠️  Vara RPC disconnect reached uncaughtException: ${getErrorMessage(error)}. Reconnecting...`);
    void varaClient.forceReconnect().catch((reconnectError) => {
      console.error('❌ Failed to reconnect after uncaught Vara RPC disconnect:', reconnectError);
    });
    return;
  }

  console.error('Uncaught exception:', error);
  process.exit(1);
});

/**
 * Fetch Polymarket data for all items in a basket
 */
async function fetchBasketItemMarkets(items: Array<{ poly_market_id: string; poly_slug: string }>): Promise<Array<PolymarketMarket | null>> {
  const markets = await Promise.all(
    items.map(async (item) => {
      // Try by ID first, then by slug
      if (item.poly_market_id) {
        const market = await fetchMarketById(item.poly_market_id, config.polymarketGammaBaseUrl);
        if (market) return market;
      }
      if (item.poly_slug) {
        return await fetchMarketBySlug(item.poly_slug, config.polymarketGammaBaseUrl);
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

    console.log(
      `${timestamp} ${logPrefix} Candidate basket loaded: status=${basket.status}, asset_kind=${basket.asset_kind}, items=${basket.items.length}`
    );

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
    if (isRetryableVaraError(error)) {
      console.warn(`${timestamp} ${logPrefix} Vara RPC connection lost: ${getErrorMessage(error)}`);
      throw error;
    }
    console.error(`${timestamp} ${logPrefix} Error:`, error);
  }
}

/**
 * Process settlements that can be finalized (after challenge deadline)
 */
async function processSettlements(basketIds: number[]): Promise<void> {
  if (!config.shouldFinalize) {
    return;
  }

  try {
    // Get contract config to show actual liveness_seconds
    const contractConfig = await varaClient.getConfig();
    const livenessMinutes = contractConfig ? (contractConfig.livenessMs / 60_000).toFixed(0) : 'unknown';
    if (contractConfig) {
      console.log(`[processSettlements] Contract liveness_ms: ${contractConfig.livenessMs} (${livenessMinutes} minutes challenge period)`);
      console.log(
        `[processSettlements] Contract roles: admin=${contractConfig.adminRole}, settler=${contractConfig.settlerRole}, varaEnabled=${contractConfig.varaEnabled}`
      );
    }

    // IMPORTANT: Contract timestamps are in MILLISECONDS (from block_timestamp())
    // So we compare in milliseconds, not seconds
    const now = Date.now(); // Current timestamp in milliseconds

    console.log(`[processSettlements] Checking ${basketIds.length} baskets for finalization (current time: ${now}ms, ${new Date(now).toISOString()})`);

    for (const basketId of basketIds) {
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
            if (isRetryableVaraError(error)) {
              console.warn(`${timestamp} [Basket ${basketId}] Vara RPC connection lost while finalizing: ${getErrorMessage(error)}`);
              throw error;
            }
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
    if (isRetryableVaraError(error)) {
      console.warn(`[processSettlements] Vara RPC connection lost: ${getErrorMessage(error)}`);
      throw error;
    }
    console.error('[processSettlements] Error processing settlements:', error);
  }
}

/**
 * Main settler bot loop
 */
async function main() {
  console.log('Starting BasketMarket Settler Bot...');
  console.log(`Vara RPC: ${config.varaRpcUrl}`);
  console.log(`BasketMarket program: ${config.basketMarketProgramId}`);
  console.log(`Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`Scan batch size: ${config.scanBatchSize} baskets per phase`);
  console.log(`Finalize enabled: ${config.shouldFinalize}`);
  console.log(`Polymarket Gamma API: ${config.polymarketGammaBaseUrl}`);
  console.log('');

  await varaClient.waitForReady();
  console.log('Connected to Vara Network');
  const contractConfig = await varaClient.getConfig();
  if (contractConfig) {
    console.log(`BasketMarket settler role: ${contractConfig.settlerRole}`);
    console.log(`BasketMarket admin role: ${contractConfig.adminRole}`);
    console.log(`BasketMarket liveness_ms: ${contractConfig.livenessMs}`);
    console.log(`BasketMarket varaEnabled: ${contractConfig.varaEnabled}`);
  } else {
    console.warn('Unable to read BasketMarket config at startup');
  }
  console.log('');

  let nextBasketToProcess = 0;
  let nextSettlementToProcess = 0;

  const poll = async () => {
    const timestamp = new Date().toISOString();
    
    try {
      // Ensure connection before polling
      await varaClient.ensureConnected();
      
      const basketCount = await varaClient.getBasketCount();
      const basketBatch = takeBasketBatch(
        nextBasketToProcess,
        basketCount,
        config.scanBatchSize,
      );
      const settlementBatch = takeBasketBatch(
        nextSettlementToProcess,
        basketCount,
        config.scanBatchSize,
      );

      nextBasketToProcess = basketBatch.next;
      nextSettlementToProcess = settlementBatch.next;

      console.log(
        `${timestamp} Polling ${basketBatch.ids.length}/${basketCount} baskets ` +
          `(next basket cursor=${nextBasketToProcess}, settlement cursor=${nextSettlementToProcess})...`,
      );

      // Process a bounded slice each cycle so one slow RPC pass cannot block the bot forever.
      for (const basketId of basketBatch.ids) {
        try {
          await processBasket(basketId);
        } catch (error) {
          // If it's a connection error, mark as disconnected and break
          if (isRetryableVaraError(error)) {
            console.warn(`${timestamp} [Basket ${basketId}] Connection lost, will retry on next poll`);
            await varaClient.forceReconnect().catch((reconnectError) => {
              console.error(`${timestamp} Failed to reconnect after basket processing disconnect:`, reconnectError);
            });
            break;
          }
          console.error(`${timestamp} [Basket ${basketId}] Error processing basket:`, error);
        }
      }

      // Process settlements that can be finalized
      if (config.shouldFinalize) {
        try {
          await processSettlements(settlementBatch.ids);
        } catch (error) {
          if (isRetryableVaraError(error)) {
            console.warn(`${timestamp} Connection lost during settlement processing, will retry on next poll`);
            await varaClient.forceReconnect().catch((reconnectError) => {
              console.error(`${timestamp} Failed to reconnect after settlement processing disconnect:`, reconnectError);
            });
          } else {
            console.error(`${timestamp} Error processing settlements:`, error);
          }
        }
      }
    } catch (error) {
      // Check if it's a connection error
      const errorMessage = getErrorMessage(error);
      if (isRetryableVaraError(error)) {
        console.warn(`${timestamp} ⚠️  Connection issue detected (${errorMessage}), will retry on next poll cycle`);
        await varaClient.forceReconnect().catch((reconnectError) => {
          console.error(`${timestamp} Failed to reconnect after poll disconnect:`, reconnectError);
        });
        // Don't throw - let the interval continue, it will retry
      } else {
        console.error(`${timestamp} ❌ Error in poll cycle:`, error);
        // For non-connection errors, still continue polling
      }
    }
  };

  let pollInFlight = false;
  const runPoll = async () => {
    if (pollInFlight) {
      console.warn(`${new Date().toISOString()} Previous poll is still running, skipping this cycle`);
      return;
    }

    pollInFlight = true;
    try {
      await poll();
    } finally {
      pollInFlight = false;
    }
  };

  // Initial poll
  await runPoll();

  // Set up interval
  const intervalId = setInterval(() => {
    void runPoll();
  }, config.pollIntervalMs);

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
