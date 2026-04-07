import { db } from "../db.js";
import { agentRegistry, agentScores } from "../schema.js";

// Activity Index weights
const PNL_WEIGHT = 0.5;
const BASKETS_WEIGHT = 0.3;
const STREAK_WEIGHT = 0.2;

// Minimum bet size: 10 CHIP = 10000000000000 raw units (12 decimals)
const MIN_BET_SIZE_RAW = 10_000_000_000_000n;

/**
 * Compute Activity Index for all registered agents and store a snapshot.
 *
 * TODO: Replace mock scores with real on-chain queries when contracts are on mainnet.
 * Real implementation should:
 *   1. Query settled baskets from BasketMarket contract to compute realized P&L per agent
 *   2. Count unique baskets each agent has bet on vs total available baskets
 *   3. Track consecutive daily claim streaks from voucher claim events
 *   4. Normalize all scores to 0-1 range
 *   5. Filter out bets below MIN_BET_SIZE_RAW (10 CHIP)
 */
export async function computeActivityIndex(): Promise<void> {
  const startTime = Date.now();
  console.log(
    `[${new Date().toISOString()}] activity-index computation starting`
  );

  try {
    // Get all registered agents
    const agents = await db.select().from(agentRegistry);

    if (agents.length === 0) {
      console.log(
        `[${new Date().toISOString()}] activity-index no agents registered, skipping`
      );
      return;
    }

    // TODO: Replace with real on-chain data fetching.
    // For now, generate deterministic mock scores based on address for consistency.
    const scoreRows = agents.map((agent) => {
      // Deterministic pseudo-random based on address bytes
      const addrNum = parseInt(agent.address.slice(2, 10), 16);
      const pnlScore = ((addrNum % 100) / 100) * 0.8 + 0.1; // 0.1 to 0.9
      const basketsScore = (((addrNum >> 8) % 100) / 100) * 0.7 + 0.15;
      const streakScore = (((addrNum >> 16) % 100) / 100) * 0.6 + 0.2;

      const compositeScore =
        PNL_WEIGHT * pnlScore +
        BASKETS_WEIGHT * basketsScore +
        STREAK_WEIGHT * streakScore;

      return {
        address: agent.address,
        pnlScore: Math.round(pnlScore * 10000) / 10000,
        basketsScore: Math.round(basketsScore * 10000) / 10000,
        streakScore: Math.round(streakScore * 10000) / 10000,
        compositeScore: Math.round(compositeScore * 10000) / 10000,
      };
    });

    // Batch insert all scores
    if (scoreRows.length > 0) {
      await db.insert(agentScores).values(scoreRows);
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[${new Date().toISOString()}] activity-index computed ${scoreRows.length} agents in ${elapsed}ms`
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(
      `[${new Date().toISOString()}] activity-index error: ${message}`
    );
  }
}
