import { useQuery } from "@tanstack/react-query";
import {
  fetchAllTimeBasketWinnings,
  type AllTimeBasketWinningsEntry,
} from "@/lib/contestLeaderboard.ts";

const REFRESH_INTERVAL_MS = 30_000;

export const useAllTimeBasketWinnings = (enabled = true) =>
  useQuery<AllTimeBasketWinningsEntry[]>({
    queryKey: ["contest-leaderboard", "all-time-basket-winnings"],
    queryFn: fetchAllTimeBasketWinnings,
    enabled,
    staleTime: 15_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
