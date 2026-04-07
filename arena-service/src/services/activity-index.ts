import { db } from "../db.js";
import { agentRegistry, agentScores } from "../schema.js";

/**
 * Activity Index formula:
 *   index = volume + (pnl * 0.001) + (time_bonus * 0.000001)
 *
 * Where:
 *   volume    -- total CHIP wagered today (dominant factor)
 *   pnl       -- net CHIP profit/loss today (tiebreaker #1)
 *   time_bonus -- (86400 - seconds_since_midnight_of_last_bet) / 86400 (tiebreaker #2, unique per agent)
 *
 * Priority is strict: 1 CHIP difference in volume always outweighs any P&L.
 * Ties are impossible because time_bonus uses on-chain timestamp.
 *
 * Why volume over basket count:
 *   basket count -> spam 1 CHIP x 100 baskets = empty tx
 *   volume -> agent that wins and reinvests generates more volume (recycled winnings)
 *   min bet per basket (10 CHIP) additionally limits spam
 */

// Minimum bet size: 10 CHIP = 10_000_000_000_000 raw units (12 decimals)
const MIN_BET_SIZE_RAW = 10_000_000_000_000n;

export async function computeActivityIndex(): Promise<void> {
  const startTime = Date.now();
  console.log(
    `[${new Date().toISOString()}] activity-index computation starting`
  );

  try {
    const agents = await db.select().from(agentRegistry);

    if (agents.length === 0) {
      console.log(
        `[${new Date().toISOString()}] activity-index no agents registered, skipping`
      );
      return;
    }

    // TODO: Replace with real on-chain data fetching.
    // Real implementation should:
    //   1. For each agent, sum all PlaceBet amounts today -> volume
    //   2. For each agent, sum settled payout minus bet amounts today -> pnl
    //   3. Get timestamp of last bet today -> compute time_bonus
    //   4. Filter out bets below MIN_BET_SIZE_RAW (10 CHIP)
    //   5. index = volume + (pnl * 0.001) + (time_bonus * 0.000001)

    // For now, generate deterministic mock data based on address for consistency.
    const scoreRows = agents.map((agent) => {
      const addrNum = parseInt(agent.address.slice(2, 10), 16);

      // Mock daily volume (50-500 CHIP range)
      const volume = 50 + (addrNum % 450);
      // Mock daily P&L (-50 to +80 CHIP)
      const pnl = -50 + ((addrNum >> 8) % 130);
      // Mock time bonus (0-1 range)
      const timeBonusSeconds = (addrNum >> 16) % 86400;
      const timeBonus = (86400 - timeBonusSeconds) / 86400;

      const compositeScore =
        volume + pnl * 0.001 + timeBonus * 0.000001;

      return {
        address: agent.address,
        volume,
        pnl,
        timeBonus: Math.round(timeBonus * 1000000) / 1000000,
        compositeScore: Math.round(compositeScore * 1000000) / 1000000,
      };
    });

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
