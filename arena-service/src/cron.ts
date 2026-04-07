import cron from "node-cron";
import { computeActivityIndex } from "./services/activity-index.js";

/**
 * Schedule the hourly Activity Index computation.
 * Runs at minute 0 of every hour.
 */
export function startCron(): void {
  // Run every hour at :00
  cron.schedule("0 * * * *", async () => {
    console.log(
      `[${new Date().toISOString()}] cron triggered: activity-index computation`
    );
    await computeActivityIndex();
  });

  console.log(
    `[${new Date().toISOString()}] cron scheduled: activity-index every hour at :00`
  );
}
