import { useQuery } from "@tanstack/react-query";
import {
  fetchPagedCommunityCurators,
  type CommunityCuratorStats,
  type PagedResult,
} from "@/lib/contestLeaderboard.ts";

const REFRESH_INTERVAL_MS = 30_000;

export type PagedCommunityCuratorEntry = CommunityCuratorStats & {
  totalRewards: string;
};

export const usePagedCommunityCurators = (
  page: number,
  pageSize: number,
  enabled = true,
) =>
  useQuery<PagedResult<PagedCommunityCuratorEntry>>({
    queryKey: ["contest-leaderboard", "paged-community-curators", page, pageSize],
    queryFn: () => fetchPagedCommunityCurators(page, pageSize),
    enabled,
    staleTime: 15_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
