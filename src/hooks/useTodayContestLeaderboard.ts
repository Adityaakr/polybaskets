import { useQuery } from "@tanstack/react-query";
import {
  fetchTodayContestLeaderboard,
  getCurrentUtcDayId,
  type TodayContestLeaderboard,
} from "@/lib/contestLeaderboard.ts";

const REFRESH_INTERVAL_MS = 30_000;

export const useTodayContestLeaderboard = () => {
  const dayId = getCurrentUtcDayId();

  return useQuery<TodayContestLeaderboard>({
    queryKey: ["contest-leaderboard", "today", dayId],
    queryFn: () => fetchTodayContestLeaderboard(dayId),
    staleTime: 15_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
};

export const useContestLeaderboard = (dayId: string) =>
  useQuery<TodayContestLeaderboard>({
    queryKey: ["contest-leaderboard", "day", dayId],
    queryFn: () => fetchTodayContestLeaderboard(dayId),
    staleTime: 15_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
