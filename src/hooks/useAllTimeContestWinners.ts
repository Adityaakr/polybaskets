import { useQuery } from "@tanstack/react-query";
import {
  fetchAllTimeTradingPnl,
  type AllTimeTradingPnlEntry,
} from "@/lib/contestLeaderboard.ts";

const REFRESH_INTERVAL_MS = 30_000;

export const useAllTimeContestWinners = () =>
  useQuery<AllTimeTradingPnlEntry[]>({
    queryKey: ["contest-leaderboard", "all-time-trading-pnl"],
    queryFn: fetchAllTimeTradingPnl,
    staleTime: 15_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
