import { ENV } from "@/env";

const CHIP_DECIMALS = 12;
const VARA_DECIMALS = 12;
const DAY_MS = 86_400_000;
const GRAPHQL_ENDPOINT = ENV.INDEXER_GRAPHQL_ENDPOINT;

type ContestDayProjectionNode = {
  dayId: string;
  status: "ready" | "settled" | "no_winner" | string;
  winnerCount: number;
  maxRealizedProfit: string | null;
  totalReward: string | null;
  settledOnChain: boolean;
  indexerComplete: boolean;
  settlementAllowedAt: string;
  settledAt: string | null;
  updatedAt: string;
};

type ContestDayWinnerNode = {
  dayId: string;
  user: string;
  realizedProfit: string;
  reward: string | null;
};

type DailyUserAggregateNode = {
  dayId: string;
  user: string;
  realizedProfit: string;
  basketCount: number;
  updatedAt: string;
};

type TodayContestLeaderboardQuery = {
  allContestDayProjections: {
    nodes: ContestDayProjectionNode[];
  };
  allDailyUserAggregates: {
    nodes: DailyUserAggregateNode[];
  };
  allContestDayWinners: {
    nodes: ContestDayWinnerNode[];
  };
};

export type ContestLeaderboardDay = ContestDayProjectionNode | null;

export type ContestLeaderboardEntry = DailyUserAggregateNode & {
  rank: number;
  reward: string | null;
  isCurrentWinner: boolean;
};

export type TodayContestLeaderboard = {
  dayId: string;
  projection: ContestLeaderboardDay;
  entries: ContestLeaderboardEntry[];
};

const TODAY_CONTEST_LEADERBOARD_QUERY = `
  query TodayContestLeaderboard(
    $projectionDayId: BigFloat!
    $aggregateDayId: BigFloat!
    $winnerDayId: String!
  ) {
    allContestDayProjections(
      condition: { dayId: $projectionDayId }
      first: 1
    ) {
      nodes {
        dayId
        status
        winnerCount
        maxRealizedProfit
        totalReward
        settledOnChain
        indexerComplete
        settlementAllowedAt
        settledAt
        updatedAt
      }
    }
    allDailyUserAggregates(
      condition: { dayId: $aggregateDayId }
      orderBy: [REALIZED_PROFIT_DESC, USER_ASC]
      first: 50
    ) {
      nodes {
        dayId
        user
        realizedProfit
        basketCount
        updatedAt
      }
    }
    allContestDayWinners(
      condition: { dayId: $winnerDayId }
      orderBy: [REALIZED_PROFIT_DESC, USER_ASC]
      first: 50
    ) {
      nodes {
        dayId
        user
        realizedProfit
        reward
      }
    }
  }
`;

export const getCurrentUtcDayId = (now = Date.now()): string =>
  Math.floor(now / DAY_MS).toString();

export const getUtcDayLabel = (dayId: string): string => {
  const date = new Date(Number(dayId) * DAY_MS);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
};

export const formatUtcDateTime = (value?: string | null): string => {
  if (!value) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));
};

const formatTokenAmount = (
  value: string | null,
  decimals: number,
  symbol: string,
  fallback = "Pending",
): string => {
  if (value === null) {
    return fallback;
  }

  const amount = BigInt(value);
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = absolute % base;
  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, 4)
    .replace(/0+$/, "");

  return `${sign}${whole.toString()}${fractionText ? `.${fractionText}` : ""} ${symbol}`;
};

export const formatChipAmount = (value: string | null): string =>
  formatTokenAmount(value, CHIP_DECIMALS, "CHIP", "0 CHIP");

export const formatVaraAmount = (value: string | null): string =>
  formatTokenAmount(value, VARA_DECIMALS, "VARA");

const graphQLRequest = async <T>(
  query: string,
  variables: Record<string, string>,
): Promise<T> => {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Indexer GraphQL request failed: ${response.status}`);
  }

  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(body.errors[0].message ?? "Indexer GraphQL error");
  }

  return body.data as T;
};

export const fetchTodayContestLeaderboard = async (
  dayId = getCurrentUtcDayId(),
): Promise<TodayContestLeaderboard> => {
  const data = await graphQLRequest<TodayContestLeaderboardQuery>(
    TODAY_CONTEST_LEADERBOARD_QUERY,
    {
      projectionDayId: dayId,
      aggregateDayId: dayId,
      winnerDayId: dayId,
    },
  );

  const rewardsByUser = new Map(
    data.allContestDayWinners.nodes.map((winner) => [winner.user, winner.reward ?? null]),
  );
  const winners = new Set(data.allContestDayWinners.nodes.map((winner) => winner.user));

  return {
    dayId,
    projection: data.allContestDayProjections.nodes[0] ?? null,
    entries: data.allDailyUserAggregates.nodes.map((entry, index) => ({
      ...entry,
      rank: index + 1,
      reward: rewardsByUser.get(entry.user) ?? null,
      isCurrentWinner: winners.has(entry.user),
    })),
  };
};
