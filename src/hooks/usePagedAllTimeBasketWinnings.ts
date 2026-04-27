import { useQuery } from "@tanstack/react-query";
import {
  fetchPagedAllTimeBasketWinnings,
  type AllTimeBasketWinningsEntry,
  type PagedResult,
} from "@/lib/contestLeaderboard.ts";

const REFRESH_INTERVAL_MS = 30_000;

export const usePagedAllTimeBasketWinnings = (
  page: number,
  pageSize: number,
  enabled = true,
) =>
  useQuery<PagedResult<AllTimeBasketWinningsEntry>>({
    queryKey: ["contest-leaderboard", "paged-all-time-basket-winnings", page, pageSize],
    queryFn: () => fetchPagedAllTimeBasketWinnings(page, pageSize),
    enabled,
    staleTime: 15_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
