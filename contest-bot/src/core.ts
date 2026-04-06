import type { DailyContestChainClient, ProjectedContestDay, ReadModelClient } from "./types.js";

export const isEligibleForSettlement = (
  day: ProjectedContestDay,
  nowMs: bigint,
): boolean => {
  if (day.settledOnChain || !day.indexerComplete) {
    return false;
  }

  if (day.status !== "ready" && day.status !== "no_winner") {
    return false;
  }

  return nowMs >= day.settlementAllowedAt;
};

export const pollOnce = async (
  readModel: ReadModelClient,
  chain: DailyContestChainClient,
): Promise<void> => {
  const day = await readModel.getOldestUnsettledDay();
  if (!day) {
    return;
  }

  const nowMs = BigInt(Date.now());
  if (!isEligibleForSettlement(day, nowMs)) {
    return;
  }

  await chain.settleDay(day);
};
