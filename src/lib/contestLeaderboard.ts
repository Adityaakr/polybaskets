import { ENV } from "@/env";
import {
  CONTEST_DAY_MS,
  getContestDayIdFromTimestamp,
  getContestDayStartDate,
  getContestDayStartTimestamp,
} from "@/lib/contestDay";

const CHIP_DECIMALS = 12;
const VARA_DECIMALS = 12;
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
  userPublicId: string;
  realizedProfit: string;
  reward: string | null;
};

type BasketNode = {
  id: string;
  basketId: string;
  assetKind: string;
  createdAt: string;
};

type ChipPositionNode = {
  basketId: string;
  user: string;
  userPublicId: string;
  shares: string;
  claimed: boolean;
  updatedAt: string;
};

type BasketSettlementNode = {
  basketId: string;
  status: string;
  finalizedAt: string | null;
};

type DailyUserAggregateNode = {
  dayId: string;
  user: string;
  userPublicId: string;
  realizedProfit: string;
  basketCount: number;
  updatedAt: string;
};

type DailyUserActivityAggregateNode = {
  dayId: string;
  user: string;
  userPublicId: string;
  txCount: number;
  basketsMade: number;
  betsPlaced: number;
  approvesCount: number;
  claimsCount: number;
  firstTxAt: string;
  lastTxAt: string;
  updatedAt: string;
};

type TodayContestLeaderboardQuery = {
  allContestDayProjections: {
    nodes: ContestDayProjectionNode[];
  };
  allDailyUserActivityAggregates: {
    nodes: DailyUserActivityAggregateNode[];
  };
  allDailyUserAggregates: {
    nodes: DailyUserAggregateNode[];
  };
  allContestDayWinners: {
    nodes: ContestDayWinnerNode[];
  };
  allBaskets: {
    nodes: BasketNode[];
  };
  allChipPositions: {
    nodes: ChipPositionNode[];
  };
  allBasketSettlements: {
    nodes: BasketSettlementNode[];
  };
  allDailyBasketContributions: {
    nodes: DailyBasketContributionNode[];
  };
};

type DailyUserAggregateProfitNode = {
  user: string;
  userPublicId: string;
  realizedProfit: string;
  basketCount: number;
};

type AllTimeTradingPnlQuery = {
  allDailyUserAggregates: {
    nodes: DailyUserAggregateProfitNode[];
  };
};

type AllTimeRewardsNode = {
  user: string;
  userPublicId: string;
  reward: string | null;
};

type AllTimeRewardsQuery = {
  allContestDayWinners: {
    nodes: AllTimeRewardsNode[];
  };
};

type DailyBasketContributionNode = {
  basketId: string;
  user: string;
  userPublicId: string;
  realizedProfit: string;
  payout: string;
  principal: string;
};

type AllTimeBasketWinningsQuery = {
  allDailyBasketContributions: {
    nodes: DailyBasketContributionNode[];
  };
};

type CommunityAgentAddressesQuery = {
  allDailyUserActivityAggregates: {
    nodes: Array<{ user: string; userPublicId: string }>;
  };
  allDailyUserAggregates: {
    nodes: Array<{ user: string; userPublicId: string }>;
  };
  allContestDayWinners: {
    nodes: Array<{ user: string; userPublicId: string }>;
  };
  allBaskets: {
    nodes: Array<{ creator: string; creatorPublicId: string }>;
  };
};

type CommunityCuratorStatsQuery = {
  allBaskets: {
    nodes: Array<{
      creator: string;
      creatorPublicId: string;
      basketId: string;
      assetKind: string;
    }>;
  };
};

type PagedAllTimeBasketStatsQuery = {
  allAllTimeBasketStats: {
    nodes: Array<{
      basketId: string;
      totalPayout: string;
      totalRealizedProfit: string;
      totalPrincipal: string;
      participantCount: number;
    }>;
  };
};

type PagedAllTimeAgentStatsQuery = {
  allAllTimeAgentStats: {
    nodes: Array<{
      address: string;
      publicId: string;
      basketCount: number;
      totalRewards: string;
      basketIds: string[];
    }>;
  };
};

export type ContestLeaderboardDay = ContestDayProjectionNode | null;

export type ContestLeaderboardEntry = DailyUserAggregateNode & {
  publicId: string;
  txCount: number;
  basketsMade: number;
  betsPlaced: number;
  approvesCount: number;
  claimsCount: number;
  firstTxAt: string | null;
  lastTxAt: string | null;
  status: "scored" | "pending";
  rank: number;
  reward: string | null;
  isCurrentWinner: boolean;
  pendingBasketCount: number;
  awaitingBasketIds: string[];
  resolvedBasketIds: string[];
};

export type TodayContestLeaderboard = {
  dayId: string;
  projection: ContestLeaderboardDay;
  entries: ContestLeaderboardEntry[];
  awaitingEntries: ContestLeaderboardEntry[];
};

export type AllTimeTradingPnlEntry = {
  rank: number;
  user: string;
  publicId: string;
  totalRealizedProfit: string;
  totalRewards: string;
  basketCount: number;
};

export type AllTimeBasketWinningsEntry = {
  rank: number;
  basketId: string;
  totalPayout: string;
  totalRealizedProfit: string;
  totalPrincipal: string;
  participantCount: number;
};

export type AgentPublicIdentity = {
  user: string;
  publicId: string;
};

export type CommunityAgentIdentity = AgentPublicIdentity;

export type CommunityCuratorStats = {
  address: string;
  publicId: string;
  basketIds: string[];
  basketCount: number;
};

export type PagedResult<T> = {
  items: T[];
  hasNextPage: boolean;
};

const TODAY_CONTEST_LEADERBOARD_QUERY = `
  query TodayContestLeaderboard(
    $projectionDayId: BigFloat!
    $activityDayId: BigFloat!
    $aggregateDayId: BigFloat!
    $winnerDayId: String!
    $dayStart: Datetime!
    $nextDayStart: Datetime!
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
    allDailyUserActivityAggregates(
      condition: { dayId: $activityDayId }
      orderBy: [TX_COUNT_DESC, FIRST_TX_AT_ASC, USER_ASC]
      first: 1000
    ) {
      nodes {
        dayId
        user
        userPublicId
        txCount
        basketsMade
        betsPlaced
        approvesCount
        claimsCount
        firstTxAt
        lastTxAt
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
        userPublicId
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
        userPublicId
        realizedProfit
        reward
      }
    }
    allBaskets(
      filter: { createdAt: { greaterThanOrEqualTo: $dayStart, lessThan: $nextDayStart } }
      first: 1000
    ) {
      nodes {
        id
        basketId
        assetKind
        createdAt
      }
    }
    allChipPositions(
      filter: { claimed: { equalTo: false } }
      first: 1000
    ) {
      nodes {
        basketId
        user
        userPublicId
        shares
        claimed
        updatedAt
      }
    }
    allBasketSettlements(
      filter: { status: { equalTo: "finalized" } }
      first: 500
    ) {
      nodes {
        basketId
        status
        finalizedAt
      }
    }
    allDailyBasketContributions(
      condition: { dayId: $aggregateDayId }
      first: 500
    ) {
      nodes {
        basketId
        user
        userPublicId
        realizedProfit
        payout
        principal
      }
    }
  }
`;

const ALL_TIME_TRADING_PNL_QUERY = `
  query AllTimeTradingPnl($offset: Int!, $first: Int!) {
    allDailyUserAggregates(
      orderBy: [USER_ASC, DAY_ID_ASC]
      offset: $offset
      first: $first
    ) {
      nodes {
        user
        userPublicId
        realizedProfit
        basketCount
      }
    }
  }
`;

const ALL_TIME_REWARDS_QUERY = `
  query AllTimeRewards($offset: Int!, $first: Int!) {
    allContestDayWinners(
      orderBy: [USER_ASC]
      offset: $offset
      first: $first
    ) {
      nodes {
        user
        userPublicId
        reward
      }
    }
  }
`;

const ALL_TIME_BASKET_WINNINGS_QUERY = `
  query AllTimeBasketWinnings($offset: Int!, $first: Int!) {
    allDailyBasketContributions(
      orderBy: [BASKET_ID_ASC, USER_ASC]
      offset: $offset
      first: $first
    ) {
      nodes {
        basketId
        user
        userPublicId
        realizedProfit
        payout
        principal
      }
    }
  }
`;

const COMMUNITY_AGENT_ADDRESSES_QUERY = `
  query CommunityAgentAddresses($offset: Int!, $first: Int!) {
    allDailyUserActivityAggregates(
      orderBy: [USER_ASC, DAY_ID_ASC]
      offset: $offset
      first: $first
    ) {
      nodes {
        user
        userPublicId
      }
    }
    allDailyUserAggregates(
      orderBy: [USER_ASC, DAY_ID_ASC]
      offset: $offset
      first: $first
    ) {
      nodes {
        user
        userPublicId
      }
    }
    allContestDayWinners(
      orderBy: [USER_ASC]
      offset: $offset
      first: $first
    ) {
      nodes {
        user
        userPublicId
      }
    }
    allBaskets(
      orderBy: [CREATOR_ASC]
      offset: $offset
      first: $first
    ) {
      nodes {
        creator
        creatorPublicId
      }
    }
  }
`;

const COMMUNITY_CURATOR_STATS_QUERY = `
  query CommunityCuratorStats($offset: Int!, $first: Int!) {
    allBaskets(
      orderBy: [CREATOR_ASC, BASKET_ID_ASC]
      offset: $offset
      first: $first
    ) {
      nodes {
        creator
        creatorPublicId
        basketId
        assetKind
      }
    }
  }
`;

const PAGED_ALL_TIME_BASKET_STATS_QUERY = `
  query PagedAllTimeBasketStats($offset: Int!, $first: Int!) {
    allAllTimeBasketStats(
      orderBy: [TOTAL_PAYOUT_DESC, BASKET_ID_ASC]
      offset: $offset
      first: $first
    ) {
      nodes {
        basketId
        totalPayout
        totalRealizedProfit
        totalPrincipal
        participantCount
      }
    }
  }
`;

const PAGED_ALL_TIME_AGENT_STATS_QUERY = `
  query PagedAllTimeAgentStats($offset: Int!, $first: Int!) {
    allAllTimeAgentStats(
      orderBy: [BASKET_COUNT_DESC, TOTAL_REWARDS_DESC, ADDRESS_ASC]
      offset: $offset
      first: $first
    ) {
      nodes {
        address
        publicId
        basketCount
        totalRewards
        basketIds
      }
    }
  }
`;

type AgentPublicIdentityQuery = {
  allDailyUserActivityAggregates: { nodes: Array<{ user: string; userPublicId: string }> };
  allDailyUserAggregates: { nodes: Array<{ user: string; userPublicId: string }> };
  allContestDayWinners: { nodes: Array<{ user: string; userPublicId: string }> };
  allChipPositions: { nodes: Array<{ user: string; userPublicId: string }> };
  allDailyBasketContributions: { nodes: Array<{ user: string; userPublicId: string }> };
  allBaskets: { nodes: Array<{ creator: string; creatorPublicId: string }> };
};

const AGENT_PUBLIC_IDENTITY_QUERY = `
  query AgentPublicIdentity($publicId: String!) {
    allDailyUserActivityAggregates(filter: { userPublicId: { equalTo: $publicId } }, first: 1) {
      nodes { user userPublicId }
    }
    allDailyUserAggregates(filter: { userPublicId: { equalTo: $publicId } }, first: 1) {
      nodes { user userPublicId }
    }
    allContestDayWinners(filter: { userPublicId: { equalTo: $publicId } }, first: 1) {
      nodes { user userPublicId }
    }
    allChipPositions(filter: { userPublicId: { equalTo: $publicId } }, first: 1) {
      nodes { user userPublicId }
    }
    allDailyBasketContributions(filter: { userPublicId: { equalTo: $publicId } }, first: 1) {
      nodes { user userPublicId }
    }
    allBaskets(filter: { creatorPublicId: { equalTo: $publicId } }, first: 1) {
      nodes { creator creatorPublicId }
    }
  }
`;

const ALL_TIME_TRADING_BATCH_SIZE = 500;

type AgentActivityHistoryQuery = {
  allDailyUserActivityAggregates: {
    nodes: Array<{
      dayId: string;
      txCount: number;
    }>;
  };
};

type AgentProfileDailyAggregatesQuery = {
  allDailyUserAggregates: {
    nodes: Array<{
      dayId: string;
      realizedProfit: string;
      basketCount: number;
      updatedAt: string;
    }>;
  };
};

type AgentProfileWinnersQuery = {
  allContestDayWinners: {
    nodes: Array<{
      dayId: string;
      realizedProfit: string;
      reward: string | null;
    }>;
  };
};

type AgentProfileActivityQuery = {
  allDailyUserActivityAggregates: {
    nodes: Array<{
      dayId: string;
      txCount: number;
      lastTxAt: string | null;
    }>;
  };
};

const AGENT_ACTIVITY_HISTORY_QUERY = `
  query AgentActivityHistory($user: String!, $offset: Int!, $first: Int!) {
    allDailyUserActivityAggregates(
      filter: { user: { equalTo: $user } }
      orderBy: [DAY_ID_DESC]
      offset: $offset
      first: $first
    ) {
      nodes {
        dayId
        txCount
      }
    }
  }
`;

const AGENT_PROFILE_DAILY_AGGREGATES_QUERY = `
  query AgentProfileDailyAggregates($user: String!, $offset: Int!, $first: Int!) {
    allDailyUserAggregates(
      filter: { user: { equalTo: $user } }
      orderBy: [DAY_ID_DESC]
      offset: $offset
      first: $first
    ) {
      nodes {
        dayId
        realizedProfit
        basketCount
        updatedAt
      }
    }
  }
`;

const AGENT_PROFILE_WINNERS_QUERY = `
  query AgentProfileWinners($user: String!, $offset: Int!, $first: Int!) {
    allContestDayWinners(
      filter: { user: { equalTo: $user } }
      orderBy: [DAY_ID_DESC]
      offset: $offset
      first: $first
    ) {
      nodes {
        dayId
        realizedProfit
        reward
      }
    }
  }
`;

const AGENT_PROFILE_ACTIVITY_QUERY = `
  query AgentProfileActivity($user: String!, $offset: Int!, $first: Int!) {
    allDailyUserActivityAggregates(
      filter: { user: { equalTo: $user } }
      orderBy: [DAY_ID_DESC]
      offset: $offset
      first: $first
    ) {
      nodes {
        dayId
        txCount
        lastTxAt
      }
    }
  }
`;

export const getCurrentUtcDayId = (now = Date.now()): string =>
  getContestDayIdFromTimestamp(now);

export const getUtcDayLabel = (dayId: string): string => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(getContestDayStartDate(dayId));
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

export const formatUtcTime = (value?: string | null): string => {
  if (!value) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
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

export const formatCompactChipAmount = (value: string | null): string => {
  if (value === null) {
    return "0 CHIP";
  }

  const amount = BigInt(value);
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const scaled = Number(absolute) / 10 ** CHIP_DECIMALS;

  const formatter = new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: scaled >= 100 ? 0 : 1,
  });
  const formatted = formatter.format(scaled);

  return `${formatted === "0" ? "" : sign}${formatted} CHIP`;
};

const chipUnitsToNumber = (value: string): number =>
  Number(BigInt(value)) / 10 ** CHIP_DECIMALS;

export const calculateActivityIndex = (
  entry: Pick<ContestLeaderboardEntry, "dayId" | "txCount" | "realizedProfit" | "firstTxAt">,
): number => {
  const pnlComponent = chipUnitsToNumber(entry.realizedProfit) * 0.001;

  if (!entry.firstTxAt) {
    return entry.txCount + pnlComponent;
  }

  const elapsedMs = Math.max(
    0,
    Math.min(
      CONTEST_DAY_MS,
      new Date(entry.firstTxAt).getTime() - getContestDayStartTimestamp(entry.dayId),
    ),
  );
  const timeBonus = 1 - elapsedMs / CONTEST_DAY_MS;

  return entry.txCount + pnlComponent + timeBonus * 0.000001;
};

export const formatActivityIndex = (
  entry: Pick<ContestLeaderboardEntry, "dayId" | "txCount" | "realizedProfit" | "firstTxAt">,
): string =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(calculateActivityIndex(entry));

const graphQLRequest = async <T>(
  query: string,
  variables: Record<string, string | number>,
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
      activityDayId: dayId,
      aggregateDayId: dayId,
      winnerDayId: dayId,
      dayStart: getContestDayStartDate(dayId).toISOString(),
      nextDayStart: getContestDayStartDate((BigInt(dayId) + 1n).toString()).toISOString(),
    },
  );

  const rewardsByUser = new Map(
    data.allContestDayWinners.nodes.map((winner) => [winner.user, winner.reward ?? null]),
  );
  const winners = new Set(data.allContestDayWinners.nodes.map((winner) => winner.user));
  const basketEntityToBasketId = new Map(
    data.allBaskets.nodes.map((basket) => [basket.id, basket.basketId]),
  );
  const selectedDayBasketIds = new Set(data.allBaskets.nodes.map((basket) => basket.id));
  const settledBasketIds = new Set(
    data.allBasketSettlements.nodes
      .filter((settlement) => settlement.status.toLowerCase() === "finalized")
      .map((settlement) => settlement.basketId),
  );
  const pendingBasketCounts = new Map<string, number>();
  const pendingBasketIdsByUser = new Map<string, Set<string>>();
  const resolvedBasketIdsByUser = new Map<string, Set<string>>();
  const realizedProfitByUser = new Map(
    data.allDailyUserAggregates.nodes.map((entry) => [entry.user.toLowerCase(), entry]),
  );

  for (const position of data.allChipPositions.nodes) {
    if (BigInt(position.shares) <= 0n) {
      continue;
    }

    if (!selectedDayBasketIds.has(position.basketId) || settledBasketIds.has(position.basketId)) {
      continue;
    }

    const userKey = position.user.toLowerCase();
    pendingBasketCounts.set(userKey, (pendingBasketCounts.get(userKey) ?? 0) + 1);
    const basketId = basketEntityToBasketId.get(position.basketId);
    if (basketId) {
      const current = pendingBasketIdsByUser.get(userKey) ?? new Set<string>();
      current.add(basketId);
      pendingBasketIdsByUser.set(userKey, current);
    }
  }

  for (const contribution of data.allDailyBasketContributions.nodes) {
    const userKey = contribution.user.toLowerCase();
    const basketId = basketEntityToBasketId.get(contribution.basketId);
    if (!basketId) {
      continue;
    }

    const current = resolvedBasketIdsByUser.get(userKey) ?? new Set<string>();
    current.add(basketId);
    resolvedBasketIdsByUser.set(userKey, current);
  }

  const scoredEntries: ContestLeaderboardEntry[] = data.allDailyUserActivityAggregates.nodes.map((entry) => ({
    dayId: entry.dayId,
    user: entry.user,
    userPublicId: entry.userPublicId,
    publicId: entry.userPublicId,
    realizedProfit: realizedProfitByUser.get(entry.user.toLowerCase())?.realizedProfit ?? "0",
    basketCount: realizedProfitByUser.get(entry.user.toLowerCase())?.basketCount ?? 0,
    updatedAt: entry.updatedAt,
    txCount: entry.txCount,
    basketsMade: entry.basketsMade,
    betsPlaced: entry.betsPlaced,
    approvesCount: entry.approvesCount,
    claimsCount: entry.claimsCount,
    firstTxAt: entry.firstTxAt,
    lastTxAt: entry.lastTxAt,
    status: "scored",
    rank: 0,
    reward: rewardsByUser.get(entry.user) ?? null,
    isCurrentWinner: winners.has(entry.user),
    pendingBasketCount: 0,
    awaitingBasketIds: [],
    resolvedBasketIds: Array.from(
      resolvedBasketIdsByUser.get(entry.user.toLowerCase()) ?? [],
    ).sort((left, right) => Number(left) - Number(right)),
  }));

  const pendingEntries: ContestLeaderboardEntry[] = Array.from(pendingBasketCounts.entries()).map(
    ([userKey, pendingBasketCount]) => {
      const matchingPosition = data.allChipPositions.nodes.find(
        (position) =>
          position.user.toLowerCase() === userKey &&
          selectedDayBasketIds.has(position.basketId) &&
          !settledBasketIds.has(position.basketId),
      );

      return {
        dayId,
        user: matchingPosition?.user ?? userKey,
        userPublicId: matchingPosition?.userPublicId ?? "",
        publicId: matchingPosition?.userPublicId ?? "",
        realizedProfit: "0",
        basketCount: pendingBasketCount,
        updatedAt: matchingPosition?.updatedAt ?? new Date(0).toISOString(),
        txCount: 0,
        basketsMade: 0,
        betsPlaced: 0,
        approvesCount: 0,
        claimsCount: 0,
        firstTxAt: matchingPosition?.updatedAt ?? null,
        lastTxAt: matchingPosition?.updatedAt ?? null,
        status: "pending",
        rank: 0,
        reward: null,
        isCurrentWinner: false,
        pendingBasketCount,
        awaitingBasketIds: Array.from(pendingBasketIdsByUser.get(userKey) ?? []).sort(
          (left, right) => Number(left) - Number(right),
        ),
        resolvedBasketIds: [],
      };
    },
  );

  const entries = scoredEntries
    .sort((left, right) => {
      const indexDiff = calculateActivityIndex(right) - calculateActivityIndex(left);
      if (indexDiff !== 0) {
        return indexDiff;
      }

      if (left.txCount !== right.txCount) {
        return right.txCount - left.txCount;
      }

      const leftFirstTxAt = left.firstTxAt ? new Date(left.firstTxAt).getTime() : Number.MAX_SAFE_INTEGER;
      const rightFirstTxAt = right.firstTxAt ? new Date(right.firstTxAt).getTime() : Number.MAX_SAFE_INTEGER;
      if (leftFirstTxAt !== rightFirstTxAt) {
        return leftFirstTxAt - rightFirstTxAt;
      }

      const leftProfit = BigInt(left.realizedProfit);
      const rightProfit = BigInt(right.realizedProfit);
      if (leftProfit !== rightProfit) {
        return rightProfit > leftProfit ? 1 : -1;
      }

      return left.user.localeCompare(right.user);
    })
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  const awaitingEntries = pendingEntries
    .sort((left, right) => {
      if (left.pendingBasketCount === right.pendingBasketCount) {
        return left.user.localeCompare(right.user);
      }

      return right.pendingBasketCount - left.pendingBasketCount;
    })
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  return {
    dayId,
    projection: data.allContestDayProjections.nodes[0] ?? null,
    entries,
    awaitingEntries,
  };
};

export const fetchAgentActivityStreak = async (
  user: string,
  dayId = getCurrentUtcDayId(),
): Promise<number> => {
  let expectedDayId = BigInt(dayId);
  let streak = 0;

  for (let offset = 0; ; offset += ALL_TIME_TRADING_BATCH_SIZE) {
    const data = await graphQLRequest<AgentActivityHistoryQuery>(
      AGENT_ACTIVITY_HISTORY_QUERY,
      {
        user,
        offset,
        first: ALL_TIME_TRADING_BATCH_SIZE,
      },
    );

    const nodes = data.allDailyUserActivityAggregates.nodes;
    if (nodes.length === 0) {
      break;
    }

    for (const node of nodes) {
      const nodeDayId = BigInt(node.dayId);
      if (nodeDayId > expectedDayId) {
        continue;
      }

      if (nodeDayId !== expectedDayId || node.txCount <= 0) {
        return streak;
      }

      streak += 1;
      expectedDayId -= 1n;
    }

    if (nodes.length < ALL_TIME_TRADING_BATCH_SIZE) {
      break;
    }
  }

  return streak;
};

export type AgentProfileSummary = {
  user: string;
  activeDays: number;
  totalTxCount: number;
  bestDailyTxCount: number;
  finalizedBasketCount: number;
  totalRealizedProfit: string;
  winningDays: number;
  totalRewards: string;
  lastIndexedActivityAt: string | null;
};

export const fetchAgentProfileSummary = async (
  user: string,
): Promise<AgentProfileSummary> => {
  let activeDays = 0;
  let totalTxCount = 0;
  let bestDailyTxCount = 0;
  let lastIndexedActivityAt: string | null = null;

  for (let offset = 0; ; offset += ALL_TIME_TRADING_BATCH_SIZE) {
    const data = await graphQLRequest<AgentProfileActivityQuery>(
      AGENT_PROFILE_ACTIVITY_QUERY,
      {
        user,
        offset,
        first: ALL_TIME_TRADING_BATCH_SIZE,
      },
    );

    const nodes = data.allDailyUserActivityAggregates.nodes;
    if (nodes.length === 0) {
      break;
    }

    for (const node of nodes) {
      if (node.txCount > 0) {
        activeDays += 1;
        totalTxCount += node.txCount;
        bestDailyTxCount = Math.max(bestDailyTxCount, node.txCount);
      }

      if (!lastIndexedActivityAt && node.lastTxAt) {
        lastIndexedActivityAt = node.lastTxAt;
      }
    }

    if (nodes.length < ALL_TIME_TRADING_BATCH_SIZE) {
      break;
    }
  }

  let finalizedBasketCount = 0;
  let totalRealizedProfit = 0n;

  for (let offset = 0; ; offset += ALL_TIME_TRADING_BATCH_SIZE) {
    const data = await graphQLRequest<AgentProfileDailyAggregatesQuery>(
      AGENT_PROFILE_DAILY_AGGREGATES_QUERY,
      {
        user,
        offset,
        first: ALL_TIME_TRADING_BATCH_SIZE,
      },
    );

    const nodes = data.allDailyUserAggregates.nodes;
    if (nodes.length === 0) {
      break;
    }

    for (const node of nodes) {
      finalizedBasketCount += node.basketCount;
      totalRealizedProfit += BigInt(node.realizedProfit);
    }

    if (nodes.length < ALL_TIME_TRADING_BATCH_SIZE) {
      break;
    }
  }

  let winningDays = 0;
  let totalRewards = 0n;

  for (let offset = 0; ; offset += ALL_TIME_TRADING_BATCH_SIZE) {
    const data = await graphQLRequest<AgentProfileWinnersQuery>(
      AGENT_PROFILE_WINNERS_QUERY,
      {
        user,
        offset,
        first: ALL_TIME_TRADING_BATCH_SIZE,
      },
    );

    const nodes = data.allContestDayWinners.nodes;
    if (nodes.length === 0) {
      break;
    }

    for (const node of nodes) {
      winningDays += 1;
      totalRewards += BigInt(node.reward ?? "0");
    }

    if (nodes.length < ALL_TIME_TRADING_BATCH_SIZE) {
      break;
    }
  }

  return {
    user,
    activeDays,
    totalTxCount,
    bestDailyTxCount,
    finalizedBasketCount,
    totalRealizedProfit: totalRealizedProfit.toString(),
    winningDays,
    totalRewards: totalRewards.toString(),
    lastIndexedActivityAt,
  };
};

export const fetchAllTimeTradingPnl = async (): Promise<AllTimeTradingPnlEntry[]> => {
  const profitTotals = new Map<
    string,
    {
      user: string;
      publicId: string;
      totalRealizedProfit: bigint;
      basketCount: number;
      totalRewards: bigint;
    }
  >();

  for (let offset = 0; ; offset += ALL_TIME_TRADING_BATCH_SIZE) {
    const data = await graphQLRequest<AllTimeTradingPnlQuery>(
      ALL_TIME_TRADING_PNL_QUERY,
      {
        offset,
        first: ALL_TIME_TRADING_BATCH_SIZE,
      },
    );

    const nodes = data.allDailyUserAggregates.nodes;
    if (nodes.length === 0) {
      break;
    }

    for (const node of nodes) {
      const realizedProfit = BigInt(node.realizedProfit);

      const key = node.user.toLowerCase();
      const current = profitTotals.get(key);

      if (current) {
        current.publicId = node.userPublicId;
        current.totalRealizedProfit += realizedProfit;
        current.basketCount += node.basketCount;
        continue;
      }

      profitTotals.set(key, {
        user: node.user,
        publicId: node.userPublicId,
        totalRealizedProfit: realizedProfit,
        basketCount: node.basketCount,
        totalRewards: 0n,
      });
    }

    if (nodes.length < ALL_TIME_TRADING_BATCH_SIZE) {
      break;
    }
  }

  for (let offset = 0; ; offset += ALL_TIME_TRADING_BATCH_SIZE) {
    const data = await graphQLRequest<AllTimeRewardsQuery>(
      ALL_TIME_REWARDS_QUERY,
      {
        offset,
        first: ALL_TIME_TRADING_BATCH_SIZE,
      },
    );

    const nodes = data.allContestDayWinners.nodes;
    if (nodes.length === 0) {
      break;
    }

    for (const node of nodes) {
      const reward = node.reward ? BigInt(node.reward) : 0n;
      const key = node.user.toLowerCase();
      const current = profitTotals.get(key);

      if (current) {
        current.publicId = node.userPublicId;
        current.totalRewards += reward;
        continue;
      }

      profitTotals.set(key, {
        user: node.user,
        publicId: node.userPublicId,
        totalRealizedProfit: 0n,
        basketCount: 0,
        totalRewards: reward,
      });
    }

    if (nodes.length < ALL_TIME_TRADING_BATCH_SIZE) {
      break;
    }
  }

  return Array.from(profitTotals.values())
    .sort((left, right) => {
      if (left.totalRealizedProfit === right.totalRealizedProfit) {
        return left.user.localeCompare(right.user);
      }

      return right.totalRealizedProfit > left.totalRealizedProfit ? 1 : -1;
    })
    .map((entry, index) => ({
      rank: index + 1,
      user: entry.user,
      publicId: entry.publicId,
      totalRealizedProfit: entry.totalRealizedProfit.toString(),
      totalRewards: entry.totalRewards.toString(),
      basketCount: entry.basketCount,
    }));
};

export const fetchCommunityAgentAddresses = async (): Promise<CommunityAgentIdentity[]> => {
  const agentsByKey = new Map<string, CommunityAgentIdentity>();

  for (let offset = 0; ; offset += ALL_TIME_TRADING_BATCH_SIZE) {
    const data = await graphQLRequest<CommunityAgentAddressesQuery>(
      COMMUNITY_AGENT_ADDRESSES_QUERY,
      {
        offset,
        first: ALL_TIME_TRADING_BATCH_SIZE,
      },
    );

    const activityNodes = data.allDailyUserActivityAggregates.nodes;
    const aggregateNodes = data.allDailyUserAggregates.nodes;
    const winnerNodes = data.allContestDayWinners.nodes;
    const basketNodes = data.allBaskets.nodes;

    for (const node of activityNodes) {
      agentsByKey.set(node.user.toLowerCase(), {
        user: node.user,
        publicId: node.userPublicId,
      });
    }

    for (const node of aggregateNodes) {
      agentsByKey.set(node.user.toLowerCase(), {
        user: node.user,
        publicId: node.userPublicId,
      });
    }

    for (const node of winnerNodes) {
      agentsByKey.set(node.user.toLowerCase(), {
        user: node.user,
        publicId: node.userPublicId,
      });
    }

    for (const node of basketNodes) {
      agentsByKey.set(node.creator.toLowerCase(), {
        user: node.creator,
        publicId: node.creatorPublicId,
      });
    }

    if (
      activityNodes.length < ALL_TIME_TRADING_BATCH_SIZE &&
      aggregateNodes.length < ALL_TIME_TRADING_BATCH_SIZE &&
      winnerNodes.length < ALL_TIME_TRADING_BATCH_SIZE &&
      basketNodes.length < ALL_TIME_TRADING_BATCH_SIZE
    ) {
      break;
    }
  }

  return Array.from(agentsByKey.values()).sort((left, right) =>
    left.user.localeCompare(right.user),
  );
};

export const fetchCommunityCuratorStats = async (): Promise<CommunityCuratorStats[]> => {
  const curatorsByKey = new Map<string, CommunityCuratorStats>();

  for (let offset = 0; ; offset += ALL_TIME_TRADING_BATCH_SIZE) {
    const data = await graphQLRequest<CommunityCuratorStatsQuery>(
      COMMUNITY_CURATOR_STATS_QUERY,
      {
        offset,
        first: ALL_TIME_TRADING_BATCH_SIZE,
      },
    );

    const nodes = data.allBaskets.nodes;
    if (nodes.length === 0) {
      break;
    }

    for (const node of nodes) {
      if (node.assetKind.toLowerCase() !== 'bet') {
        continue;
      }

      const key = node.creator.toLowerCase();
      const current = curatorsByKey.get(key);

      if (current) {
        current.publicId = node.creatorPublicId || current.publicId;
        current.basketIds.push(node.basketId);
        current.basketCount += 1;
        continue;
      }

      curatorsByKey.set(key, {
        address: node.creator,
        publicId: node.creatorPublicId,
        basketIds: [node.basketId],
        basketCount: 1,
      });
    }

    if (nodes.length < ALL_TIME_TRADING_BATCH_SIZE) {
      break;
    }
  }

  return Array.from(curatorsByKey.values()).sort((left, right) =>
    left.address.localeCompare(right.address),
  );
};

export const fetchPagedAllTimeBasketWinnings = async (
  page: number,
  pageSize: number,
): Promise<PagedResult<AllTimeBasketWinningsEntry>> => {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  const offset = (safePage - 1) * safePageSize;

  const data = await graphQLRequest<PagedAllTimeBasketStatsQuery>(
    PAGED_ALL_TIME_BASKET_STATS_QUERY,
    {
      offset,
      first: safePageSize + 1,
    },
  );

  const nodes = data.allAllTimeBasketStats.nodes;
  const items = nodes.slice(0, safePageSize).map((node, index) => ({
    rank: offset + index + 1,
    basketId: node.basketId,
    totalPayout: node.totalPayout,
    totalRealizedProfit: node.totalRealizedProfit,
    totalPrincipal: node.totalPrincipal,
    participantCount: node.participantCount,
  }));

  return {
    items,
    hasNextPage: nodes.length > safePageSize,
  };
};

export const fetchPagedCommunityCurators = async (
  page: number,
  pageSize: number,
): Promise<PagedResult<CommunityCuratorStats & { totalRewards: string }>> => {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  const offset = (safePage - 1) * safePageSize;

  const data = await graphQLRequest<PagedAllTimeAgentStatsQuery>(
    PAGED_ALL_TIME_AGENT_STATS_QUERY,
    {
      offset,
      first: safePageSize + 1,
    },
  );

  const nodes = data.allAllTimeAgentStats.nodes;
  return {
    items: nodes.slice(0, safePageSize).map((node) => ({
      address: node.address,
      publicId: node.publicId,
      basketCount: node.basketCount,
      basketIds: node.basketIds ?? [],
      totalRewards: node.totalRewards,
    })),
    hasNextPage: nodes.length > safePageSize,
  };
};

export const fetchAgentAddressByPublicId = async (
  publicId: string,
): Promise<AgentPublicIdentity | null> => {
  const normalizedPublicId = publicId.trim();
  if (!normalizedPublicId) {
    return null;
  }

  const data = await graphQLRequest<AgentPublicIdentityQuery>(
    AGENT_PUBLIC_IDENTITY_QUERY,
    { publicId: normalizedPublicId },
  );

  const userNode =
    data.allDailyUserActivityAggregates.nodes[0] ??
    data.allDailyUserAggregates.nodes[0] ??
    data.allContestDayWinners.nodes[0] ??
    data.allChipPositions.nodes[0] ??
    data.allDailyBasketContributions.nodes[0];

  if (userNode) {
    return {
      user: userNode.user,
      publicId: userNode.userPublicId,
    };
  }

  const basketNode = data.allBaskets.nodes[0];
  if (basketNode) {
    return {
      user: basketNode.creator,
      publicId: basketNode.creatorPublicId,
    };
  }

  return null;
};

export const fetchAllTimeBasketWinnings = async (): Promise<AllTimeBasketWinningsEntry[]> => {
  const basketTotals = new Map<
    string,
    {
      basketId: string;
      totalPayout: bigint;
      totalRealizedProfit: bigint;
      totalPrincipal: bigint;
      participants: Set<string>;
    }
  >();

  for (let offset = 0; ; offset += ALL_TIME_TRADING_BATCH_SIZE) {
    const data = await graphQLRequest<AllTimeBasketWinningsQuery>(
      ALL_TIME_BASKET_WINNINGS_QUERY,
      {
        offset,
        first: ALL_TIME_TRADING_BATCH_SIZE,
      },
    );

    const nodes = data.allDailyBasketContributions.nodes;
    if (nodes.length === 0) {
      break;
    }

    for (const node of nodes) {
      const key = node.basketId.toLowerCase();
      const current =
        basketTotals.get(key) ??
        {
          basketId: node.basketId,
          totalPayout: 0n,
          totalRealizedProfit: 0n,
          totalPrincipal: 0n,
          participants: new Set<string>(),
        };

      current.totalPayout += BigInt(node.payout);
      current.totalRealizedProfit += BigInt(node.realizedProfit);
      current.totalPrincipal += BigInt(node.principal);
      current.participants.add(node.user.toLowerCase());

      basketTotals.set(key, current);
    }

    if (nodes.length < ALL_TIME_TRADING_BATCH_SIZE) {
      break;
    }
  }

  return Array.from(basketTotals.values())
    .sort((left, right) => {
      if (left.totalPayout === right.totalPayout) {
        if (left.totalRealizedProfit === right.totalRealizedProfit) {
          return left.basketId.localeCompare(right.basketId);
        }

        return right.totalRealizedProfit > left.totalRealizedProfit ? 1 : -1;
      }

      return right.totalPayout > left.totalPayout ? 1 : -1;
    })
    .map((entry, index) => ({
      rank: index + 1,
      basketId: entry.basketId,
      totalPayout: entry.totalPayout.toString(),
      totalRealizedProfit: entry.totalRealizedProfit.toString(),
      totalPrincipal: entry.totalPrincipal.toString(),
      participantCount: entry.participants.size,
    }));
};

type AgentHistoricalBasketIdsQuery = {
  allDailyBasketContributions: {
    nodes: Array<{
      basketId: string;
      finalizedAt: string;
    }>;
  };
};

const AGENT_HISTORICAL_BASKET_IDS_QUERY = `
  query AgentHistoricalBasketIds($user: String!, $offset: Int!, $first: Int!) {
    allDailyBasketContributions(
      filter: { user: { equalTo: $user } }
      orderBy: [FINALIZED_AT_DESC, BASKET_ID_ASC]
      offset: $offset
      first: $first
    ) {
      nodes {
        basketId
        finalizedAt
      }
    }
  }
`;

export const fetchAgentHistoricalBasketIds = async (user: string): Promise<string[]> => {
  const basketIds = new Set<string>();

  for (let offset = 0; ; offset += ALL_TIME_TRADING_BATCH_SIZE) {
    const data = await graphQLRequest<AgentHistoricalBasketIdsQuery>(
      AGENT_HISTORICAL_BASKET_IDS_QUERY,
      {
        user,
        offset,
        first: ALL_TIME_TRADING_BATCH_SIZE,
      },
    );

    const nodes = data.allDailyBasketContributions.nodes;
    if (nodes.length === 0) {
      break;
    }

    for (const node of nodes) {
      basketIds.add(node.basketId.split(":").pop() ?? node.basketId);
    }

    if (nodes.length < ALL_TIME_TRADING_BATCH_SIZE) {
      break;
    }
  }

  return Array.from(basketIds);
};
