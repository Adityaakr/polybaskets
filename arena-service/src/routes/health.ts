import { Hono } from "hono";
import { db } from "../db.js";
import { agentScores } from "../schema.js";
import { desc } from "drizzle-orm";

const health = new Hono();

health.get("/health", async (c) => {
  let lastComputedAt: string | null = null;

  try {
    const latest = await db
      .select({ computedAt: agentScores.computedAt })
      .from(agentScores)
      .orderBy(desc(agentScores.computedAt))
      .limit(1);

    if (latest.length > 0) {
      lastComputedAt = latest[0].computedAt.toISOString();
    }
  } catch {
    // DB might not be ready yet -- still return ok
  }

  return c.json({
    status: "ok",
    last_computed_at: lastComputedAt,
  });
});

export default health;
