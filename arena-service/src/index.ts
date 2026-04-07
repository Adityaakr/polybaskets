import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import healthRoute from "./routes/health.js";
import namesRoute from "./routes/names.js";
import leaderboardRoute from "./routes/leaderboard.js";
import { startCron } from "./cron.js";

const app = new Hono();

// -- Middleware --

app.use(
  "*",
  cors({
    origin: [
      "https://polybaskets.xyz",
      "https://app.polybaskets.xyz",
      "http://localhost:8080",
      "http://localhost:5173",
    ],
  })
);

app.use("*", logger());

// -- Routes --

app.route("/", healthRoute);
app.route("/api/names", namesRoute);
app.route("/api", leaderboardRoute);

// -- Start --

const port = parseInt(process.env.PORT || "3002", 10);

console.log(`[${new Date().toISOString()}] arena-service starting on port ${port}`);

serve({ fetch: app.fetch, port }, () => {
  console.log(`[${new Date().toISOString()}] arena-service listening on port ${port}`);
  startCron();
});
