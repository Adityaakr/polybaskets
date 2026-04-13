import { useQuery } from "@tanstack/react-query";
import {
  fetchProjectStatsDataset,
  type ProjectStatsDataset,
} from "@/lib/projectStats";

const REFRESH_INTERVAL_MS = 60_000;

export const useProjectStats = () =>
  useQuery<ProjectStatsDataset>({
    queryKey: ["project-stats", "dataset"],
    queryFn: fetchProjectStatsDataset,
    staleTime: 30_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
