import { Hono } from "hono";
import { db } from "../db.js";
import { agentScores, agentNames, agentRegistry } from "../schema.js";
import { desc, eq, sql } from "drizzle-orm";

const leaderboard = new Hono();

// Simple in-memory cache with TTL
let leaderboardCache: { data: unknown; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 60 seconds

// GET /api/leaderboard -- ranked agents by Activity Index (composite_score)
leaderboard.get("/leaderboard", async (c) => {
  const now = Date.now();

  if (leaderboardCache && leaderboardCache.expiresAt > now) {
    return c.json(leaderboardCache.data);
  }

  try {
    // Get the latest score per agent using a subquery for max computed_at
    const latestScores = await db
      .select({
        address: agentScores.address,
        pnlScore: agentScores.pnlScore,
        basketsScore: agentScores.basketsScore,
        streakScore: agentScores.streakScore,
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
          composite_score: score.compositeScore,
          pnl_score: score.pnlScore,
          baskets_score: score.basketsScore,
          streak_score: score.streakScore,
          last_computed_at: score.computedAt.toISOString(),
        };
      })
    );

    // Get the most recent computation timestamp
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

// GET /api/agents/:addr -- agent detail with index breakdown
leaderboard.get("/agents/:addr", async (c) => {
  const addr = c.req.param("addr");

  try {
    // Check if agent is registered
    const agent = await db
      .select()
      .from(agentRegistry)
      .where(eq(agentRegistry.address, addr))
      .limit(1);

    if (agent.length === 0) {
      return c.json({ error: "agent not found" }, 404);
    }

    // Get display name
    const nameRow = await db
      .select()
      .from(agentNames)
      .where(eq(agentNames.address, addr))
      .limit(1);

    // Get latest score
    const latestScore = await db
      .select()
      .from(agentScores)
      .where(eq(agentScores.address, addr))
      .orderBy(desc(agentScores.computedAt))
      .limit(1);

    // Get score history (last 24 entries = 24 hours)
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
      current_score: score
        ? {
            composite_score: score.compositeScore,
            pnl_score: score.pnlScore,
            baskets_score: score.basketsScore,
            streak_score: score.streakScore,
            computed_at: score.computedAt.toISOString(),
          }
        : null,
      score_history: history.map((h) => ({
        composite_score: h.compositeScore,
        pnl_score: h.pnlScore,
        baskets_score: h.basketsScore,
        streak_score: h.streakScore,
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
