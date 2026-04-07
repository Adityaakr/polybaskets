import { Hono } from "hono";
import { db } from "../db.js";
import { agentScores, agentNames, agentRegistry } from "../schema.js";
import { desc, eq, sql } from "drizzle-orm";

const leaderboard = new Hono();

// Simple in-memory cache with TTL
let leaderboardCache: { data: unknown; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 60 seconds

// GET /api/leaderboard -- ranked agents by Activity Index
// Index = volume + (pnl * 0.001) + (time_bonus * 0.000001)
// Sorted by composite_score desc. Volume dominates, P&L is tiebreaker #1, time_bonus is #2.
leaderboard.get("/leaderboard", async (c) => {
  const now = Date.now();

  if (leaderboardCache && leaderboardCache.expiresAt > now) {
    return c.json(leaderboardCache.data);
  }

  try {
    const latestScores = await db
      .select({
        address: agentScores.address,
        volume: agentScores.volume,
        pnl: agentScores.pnl,
        timeBonus: agentScores.timeBonus,
        compositeScore: agentScores.compositeScore,
        computedAt: agentScores.computedAt,
      })
      .from(agentScores)
      .where(
        sql`(${agentScores.address}, ${agentScores.computedAt}) IN (
          SELECT address, MAX(computed_at) FROM agent_scores GROUP BY address
        )`
      )
      .orderBy(desc(agentScores.compositeScore));

    // Resolve display names
    const ranked = await Promise.all(
      latestScores.map(async (score, idx) => {
        const nameRow = await db
          .select({ displayName: agentNames.displayName })
          .from(agentNames)
          .where(eq(agentNames.address, score.address))
          .limit(1);

        return {
          rank: idx + 1,
          address: score.address,
          display_name: nameRow.length > 0 ? nameRow[0].displayName : null,
          index: score.compositeScore,
          volume: score.volume,
          pnl: score.pnl,
        };
      })
    );

    let lastComputedAt: string | null = null;
    if (latestScores.length > 0) {
      const maxDate = latestScores.reduce((max, s) =>
        s.computedAt > max.computedAt ? s : max
      );
      lastComputedAt = maxDate.computedAt.toISOString();
    }

    const response = {
      agents: ranked,
      last_computed_at: lastComputedAt,
    };

    leaderboardCache = { data: response, expiresAt: now + CACHE_TTL_MS };
    return c.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(
      `[${new Date().toISOString()}] leaderboard error: ${message}`
    );
    return c.json({ error: "internal server error" }, 500);
  }
});

// GET /api/agents/:addr -- agent detail with expanded info
leaderboard.get("/agents/:addr", async (c) => {
  const addr = c.req.param("addr");

  try {
    const agent = await db
      .select()
      .from(agentRegistry)
      .where(eq(agentRegistry.address, addr))
      .limit(1);

    if (agent.length === 0) {
      return c.json({ error: "agent not found" }, 404);
    }

    const nameRow = await db
      .select()
      .from(agentNames)
      .where(eq(agentNames.address, addr))
      .limit(1);

    const latestScore = await db
      .select()
      .from(agentScores)
      .where(eq(agentScores.address, addr))
      .orderBy(desc(agentScores.computedAt))
      .limit(1);

    // Last 24 snapshots for history
    const history = await db
      .select()
      .from(agentScores)
      .where(eq(agentScores.address, addr))
      .orderBy(desc(agentScores.computedAt))
      .limit(24);

    const score = latestScore.length > 0 ? latestScore[0] : null;

    return c.json({
      address: addr,
      display_name: nameRow.length > 0 ? nameRow[0].displayName : null,
      registered_at: agent[0].registeredAt.toISOString(),
      current: score
        ? {
            index: score.compositeScore,
            volume: score.volume,
            pnl: score.pnl,
            time_bonus: score.timeBonus,
            computed_at: score.computedAt.toISOString(),
          }
        : null,
      history: history.map((h) => ({
        index: h.compositeScore,
        volume: h.volume,
        pnl: h.pnl,
        computed_at: h.computedAt.toISOString(),
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(
      `[${new Date().toISOString()}] agent-detail error: ${message}`
    );
    return c.json({ error: "internal server error" }, 500);
  }
});

export default leaderboard;
