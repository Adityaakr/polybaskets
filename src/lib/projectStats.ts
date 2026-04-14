import { ENV } from "@/env";
import { getContestDayStartDate } from "@/lib/contestDay";
import { getCurrentUtcDayId } from "@/lib/contestLeaderboard";

const GRAPHQL_ENDPOINT = ENV.INDEXER_GRAPHQL_ENDPOINT;
const CHIP_DECIMALS = 12;
const VARA_DECIMALS = 12;
const BATCH_SIZE = 500;

type ActivityAggregateNode = {
  id: string;
  dayId: string;
  user: string;
  txCount: number;
  basketsMade: number;
  betsPlaced: number;
  approvesCount: number;
  claimsCount: number;
  lastTxAt: string;
};

type DailyAggregateNode = {
  id: string;
  dayId: string;
  user: string;
  realizedProfit: string;
  basketCount: number;
};

type ContestDayProjectionNode = {
  id: string;
  dayId: string;
  status: "ready" | "settled" | "no_winner" | string;
  winnerCount: number;
  totalReward: string | null;
  maxRealizedProfit: string | null;
  settledOnChain: boolean;
  indexerComplete: boolean;
  settlementAllowedAt: string;
  settledAt: string | null;
  updatedAt: string;
};

type ContestDayWinnerNode = {
  id: string;
  dayId: string;
  user: string;
  realizedProfit: string;
  reward: string | null;
};

type DailyBasketContributionNode = {
  id: string;
  dayId: string;
  basketId: string;
  user: string;
  realizedProfit: string;
  payout: string;
  principal: string;
  finalizedAt: string;
};

type GraphQLNodesResponse<TNode> = {
  nodes: TNode[];
};

type ProjectStatsDatasetQuery = {
  allDailyUserActivityAggregates?: GraphQLNodesResponse<ActivityAggregateNode>;
  allDailyUserAggregates?: GraphQLNodesResponse<DailyAggregateNode>;
  allContestDayProjections?: GraphQLNodesResponse<ContestDayProjectionNode>;
  allContestDayWinners?: GraphQLNodesResponse<ContestDayWinnerNode>;
  allDailyBasketContributions?: GraphQLNodesResponse<DailyBasketContributionNode>;
};

export type ProjectStatsRange = "today" | "7d" | "30d" | "90d" | "all";
export type ProjectStatsSelection =
  | { mode: "preset"; range: ProjectStatsRange }
  | { mode: "custom"; fromDayId: string; toDayId: string };
export type TopAgentsSortKey =
  | "transactions"
  | "realizedProfit"
  | "wins"
  | "activeDays"
  | "rewards";

export type ProjectStatsDataset = {
  activities: ActivityAggregateNode[];
  aggregates: DailyAggregateNode[];
  projections: ContestDayProjectionNode[];
  winners: ContestDayWinnerNode[];
  contributions: DailyBasketContributionNode[];
};

export type ProjectStatsSummary = {
  activeAgents: number;
  newAgents: number;
  returningAgents: number;
  totalTransactions: number;
  totalBasketsMade: number;
  totalBetsPlaced: number;
  totalApproves: number;
  totalClaims: number;
  totalRealizedProfit: bigint;
  totalRewardsPaid: bigint;
  totalSettledPrincipal: bigint;
  totalSettledPayout: bigint;
  totalSettledBaskets: number;
  uniqueBasketCreators: number;
  settledDays: number;
  readyDays: number;
  noWinnerDays: number;
  uniqueWinners: number;
  avgTxPerActiveAgent: number;
  avgWinningTxCount: number;
  avgWinningRealizedProfit: bigint;
  profitableAgentShare: number;
};

export type ProjectStatsDailyRow = {
  dayId: string;
  label: string;
  status: string;
  settledOnChain: boolean;
  indexerComplete: boolean;
  activeAgents: number;
  newAgents: number;
  transactions: number;
  basketsMade: number;
  betsPlaced: number;
  approves: number;
  claims: number;
  realizedProfit: bigint;
  rewardsPaid: bigint;
  settledPrincipal: bigint;
  settledPayout: bigint;
  settledBaskets: number;
  winnerUser: string | null;
  winnerTxCount: number;
  winnerRealizedProfit: bigint | null;
};

export type ProjectStatsAgentRow = {
  user: string;
  txCount: number;
  basketsMade: number;
  betsPlaced: number;
  approvesCount: number;
  claimsCount: number;
  activeDays: number;
  realizedProfit: bigint;
  settledBasketCount: number;
  wins: number;
  rewardsPaid: bigint;
  currentStreak: number;
  longestStreak: number;
  firstActiveDayId: string | null;
  lastActiveDayId: string | null;
};

export type ProjectStatsView = {
  range: ProjectStatsRange | "custom";
  fromDayId: string | null;
  toDayId: string;
  coverage: {
    firstActivityDayId: string | null;
    lastActivityDayId: string | null;
    indexedDays: number;
  };
  summary: ProjectStatsSummary;
  dailyRows: ProjectStatsDailyRow[];
  topAgents: ProjectStatsAgentRow[];
};

const ALL_ACTIVITY_BATCH_QUERY = `
  query ProjectStatsActivityBatch($offset: Int!, $first: Int!) {
    allDailyUserActivityAggregates(orderBy: [ID_ASC], offset: $offset, first: $first) {
      nodes {
        id
        dayId
        user
        txCount
        basketsMade
        betsPlaced
        approvesCount
        claimsCount
        lastTxAt
      }
    }
  }
`;

const ALL_AGGREGATES_BATCH_QUERY = `
  query ProjectStatsAggregateBatch($offset: Int!, $first: Int!) {
    allDailyUserAggregates(orderBy: [ID_ASC], offset: $offset, first: $first) {
      nodes {
        id
        dayId
        user
        realizedProfit
        basketCount
      }
    }
  }
`;

const ALL_PROJECTIONS_BATCH_QUERY = `
  query ProjectStatsProjectionBatch($offset: Int!, $first: Int!) {
    allContestDayProjections(orderBy: [ID_ASC], offset: $offset, first: $first) {
      nodes {
        id
        dayId
        status
        winnerCount
        totalReward
        maxRealizedProfit
        settledOnChain
        indexerComplete
        settlementAllowedAt
        settledAt
        updatedAt
      }
    }
  }
`;

const ALL_WINNERS_BATCH_QUERY = `
  query ProjectStatsWinnerBatch($offset: Int!, $first: Int!) {
    allContestDayWinners(orderBy: [ID_ASC], offset: $offset, first: $first) {
      nodes {
        id
        dayId
        user
        realizedProfit
        reward
      }
    }
  }
`;

const ALL_CONTRIBUTIONS_BATCH_QUERY = `
  query ProjectStatsContributionBatch($offset: Int!, $first: Int!) {
    allDailyBasketContributions(orderBy: [ID_ASC], offset: $offset, first: $first) {
      nodes {
        id
        dayId
        basketId
        user
        realizedProfit
        payout
        principal
        finalizedAt
      }
    }
  }
`;

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

const fetchPaginatedNodes = async <TNode>(
  query: string,
  field: keyof ProjectStatsDatasetQuery,
): Promise<TNode[]> => {
  const items: TNode[] = [];

  for (let offset = 0; ; offset += BATCH_SIZE) {
    const data = await graphQLRequest<ProjectStatsDatasetQuery>(query, {
      offset,
      first: BATCH_SIZE,
    });
    const nodes = (data[field]?.nodes ?? []) as TNode[];
    if (nodes.length === 0) {
      break;
    }

    items.push(...nodes);

    if (nodes.length < BATCH_SIZE) {
      break;
    }
  }

  return items;
};

const getRangeStartDayId = (
  range: ProjectStatsRange,
  currentDayId: bigint,
): bigint | null => {
  switch (range) {
    case "today":
      return currentDayId;
    case "7d":
      return currentDayId - 6n;
    case "30d":
      return currentDayId - 29n;
    case "90d":
      return currentDayId - 89n;
    case "all":
    default:
      return null;
  }
};

const normalizeCustomRange = (
  fromDayId: bigint,
  toDayId: bigint,
): { fromDayId: bigint; toDayId: bigint } =>
  fromDayId <= toDayId
    ? { fromDayId, toDayId }
    : { fromDayId: toDayId, toDayId: fromDayId };

const isDayInRange = (
  dayId: bigint,
  currentDayId: bigint,
  startDayId: bigint | null,
): boolean => {
  if (dayId > currentDayId) {
    return false;
  }

  if (startDayId === null) {
    return true;
  }

  return dayId >= startDayId;
};

const getUtcDayLabel = (dayId: string): string =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(getContestDayStartDate(dayId));

const uniqueSortedBigInts = (values: Iterable<bigint>): bigint[] =>
  Array.from(new Set(Array.from(values, (value) => value.toString()))).map(BigInt).sort(
    (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  );

const computeStreaks = (
  dayIds: bigint[],
  currentDayId: bigint,
): { currentStreak: number; longestStreak: number } => {
  if (dayIds.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  let longestStreak = 1;
  let runningStreak = 1;

  for (let index = 1; index < dayIds.length; index += 1) {
    if (dayIds[index] === dayIds[index - 1] + 1n) {
      runningStreak += 1;
      longestStreak = Math.max(longestStreak, runningStreak);
      continue;
    }

    runningStreak = 1;
  }

  let currentStreak = 0;
  let expectedDayId = currentDayId;
  const dayIdSet = new Set(dayIds.map((value) => value.toString()));

  while (dayIdSet.has(expectedDayId.toString())) {
    currentStreak += 1;
    expectedDayId -= 1n;
  }

  return { currentStreak, longestStreak };
};

const asBigInt = (value: string | null | undefined): bigint =>
  value ? BigInt(value) : 0n;

export const formatCompactNumber = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);

export const formatPercentage = (value: number): string =>
  `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value)}%`;

export const formatCompactTokenAmount = (
  value: bigint,
  decimals: number,
  symbol: string,
): string => {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const scaled = Number(absolute) / 10 ** decimals;
  const formatter = new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: scaled >= 100 ? 0 : 1,
  });

  return `${sign}${formatter.format(scaled)} ${symbol}`;
};

export const formatCompactChipAmount = (value: bigint): string =>
  formatCompactTokenAmount(value, CHIP_DECIMALS, "CHIP");

export const formatCompactVaraAmount = (value: bigint): string =>
  formatCompactTokenAmount(value, VARA_DECIMALS, "VARA");

export const formatPreciseTokenAmount = (
  value: bigint,
  decimals: number,
  symbol: string,
): string => {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = absolute % base;
  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, 4)
    .replace(/0+$/, "");

  const formattedWhole = new Intl.NumberFormat("en-US").format(Number(whole));

  return `${sign}${formattedWhole}${fractionText ? `.${fractionText}` : ""} ${symbol}`;
};

export const formatPreciseChipAmount = (value: bigint): string =>
  formatPreciseTokenAmount(value, CHIP_DECIMALS, "CHIP");

export const fetchProjectStatsDataset = async (): Promise<ProjectStatsDataset> => {
  const [activities, aggregates, projections, winners, contributions] =
    await Promise.all([
      fetchPaginatedNodes<ActivityAggregateNode>(
        ALL_ACTIVITY_BATCH_QUERY,
        "allDailyUserActivityAggregates",
      ),
      fetchPaginatedNodes<DailyAggregateNode>(
        ALL_AGGREGATES_BATCH_QUERY,
        "allDailyUserAggregates",
      ),
      fetchPaginatedNodes<ContestDayProjectionNode>(
        ALL_PROJECTIONS_BATCH_QUERY,
        "allContestDayProjections",
      ),
      fetchPaginatedNodes<ContestDayWinnerNode>(
        ALL_WINNERS_BATCH_QUERY,
        "allContestDayWinners",
      ),
      fetchPaginatedNodes<DailyBasketContributionNode>(
        ALL_CONTRIBUTIONS_BATCH_QUERY,
        "allDailyBasketContributions",
      ),
    ]);

  return {
    activities,
    aggregates,
    projections,
    winners,
    contributions,
  };
};

export const buildProjectStatsView = (
  dataset: ProjectStatsDataset,
  selection: ProjectStatsSelection,
  now = Date.now(),
): ProjectStatsView => {
  const currentDayId = BigInt(getCurrentUtcDayId(now));
  const presetRange = selection.mode === "preset" ? selection.range : null;
  const customRange =
    selection.mode === "custom"
      ? normalizeCustomRange(BigInt(selection.fromDayId), BigInt(selection.toDayId))
      : null;
  const startDayId =
    selection.mode === "preset"
      ? getRangeStartDayId(selection.range, currentDayId)
      : customRange?.fromDayId ?? null;
  const endDayId =
    selection.mode === "preset"
      ? currentDayId
      : customRange?.toDayId ?? currentDayId;

  const allActivityDayIds = dataset.activities.map((item) => BigInt(item.dayId));
  const sortedActivityDayIds = allActivityDayIds.length
    ? uniqueSortedBigInts(allActivityDayIds)
    : [];
  const coverageFirstDayId = sortedActivityDayIds[0]?.toString() ?? null;
  const coverageLastDayId =
    sortedActivityDayIds[sortedActivityDayIds.length - 1]?.toString() ?? null;

  const allActiveDaysByUser = new Map<string, bigint[]>();
  const firstActiveDayByUser = new Map<string, bigint>();
  const activityByDayAndUser = new Map<string, ActivityAggregateNode>();

  for (const activity of dataset.activities) {
    if (activity.txCount <= 0) {
      continue;
    }

    const userKey = activity.user.toLowerCase();
    const dayId = BigInt(activity.dayId);
    const existing = allActiveDaysByUser.get(userKey) ?? [];
    existing.push(dayId);
    allActiveDaysByUser.set(userKey, existing);
    activityByDayAndUser.set(`${activity.dayId}:${userKey}`, activity);

    const firstSeen = firstActiveDayByUser.get(userKey);
    if (firstSeen === undefined || dayId < firstSeen) {
      firstActiveDayByUser.set(userKey, dayId);
    }
  }

  const streaksByUser = new Map<
    string,
    { currentStreak: number; longestStreak: number; firstActiveDayId: string | null; lastActiveDayId: string | null }
  >();

  for (const [userKey, dayIds] of allActiveDaysByUser.entries()) {
    const normalized = uniqueSortedBigInts(dayIds);
    const streaks = computeStreaks(normalized, currentDayId);
    streaksByUser.set(userKey, {
      ...streaks,
      firstActiveDayId: normalized[0]?.toString() ?? null,
      lastActiveDayId: normalized[normalized.length - 1]?.toString() ?? null,
    });
  }

  const dayRows = new Map<
    string,
    {
      projection: ContestDayProjectionNode | null;
      activeUsers: Set<string>;
      newUsers: Set<string>;
      transactions: number;
      basketsMade: number;
      betsPlaced: number;
      approves: number;
      claims: number;
      realizedProfit: bigint;
      rewardsPaid: bigint;
      settledPrincipal: bigint;
      settledPayout: bigint;
      settledBasketIds: Set<string>;
      winnerUser: string | null;
      winnerRealizedProfit: bigint | null;
      winnerTxCount: number;
    }
  >();

  const topAgentRows = new Map<string, ProjectStatsAgentRow>();
  const basketCreatorsByActivity = new Set<string>();

  const ensureDayRow = (dayId: string) => {
    const existing = dayRows.get(dayId);
    if (existing) {
      return existing;
    }

    const next = {
      projection: null,
      activeUsers: new Set<string>(),
      newUsers: new Set<string>(),
      transactions: 0,
      basketsMade: 0,
      betsPlaced: 0,
      approves: 0,
      claims: 0,
      realizedProfit: 0n,
      rewardsPaid: 0n,
      settledPrincipal: 0n,
      settledPayout: 0n,
      settledBasketIds: new Set<string>(),
      winnerUser: null,
      winnerRealizedProfit: null,
      winnerTxCount: 0,
    };
    dayRows.set(dayId, next);
    return next;
  };

  const ensureTopAgent = (user: string) => {
    const userKey = user.toLowerCase();
    const existing = topAgentRows.get(userKey);
    if (existing) {
      return existing;
    }

    const streaks = streaksByUser.get(userKey);
    const next: ProjectStatsAgentRow = {
      user,
      txCount: 0,
      basketsMade: 0,
      betsPlaced: 0,
      approvesCount: 0,
      claimsCount: 0,
      activeDays: 0,
      realizedProfit: 0n,
      settledBasketCount: 0,
      wins: 0,
      rewardsPaid: 0n,
      currentStreak: streaks?.currentStreak ?? 0,
      longestStreak: streaks?.longestStreak ?? 0,
      firstActiveDayId: streaks?.firstActiveDayId ?? null,
      lastActiveDayId: streaks?.lastActiveDayId ?? null,
    };
    topAgentRows.set(userKey, next);
    return next;
  };

  for (const projection of dataset.projections) {
    const dayId = BigInt(projection.dayId);
    if (!isDayInRange(dayId, endDayId, startDayId)) {
      continue;
    }

    ensureDayRow(projection.dayId).projection = projection;
  }

  for (const activity of dataset.activities) {
    const dayId = BigInt(activity.dayId);
    if (!isDayInRange(dayId, endDayId, startDayId)) {
      continue;
    }

    const dayRow = ensureDayRow(activity.dayId);
    const userKey = activity.user.toLowerCase();

    dayRow.activeUsers.add(userKey);
    if (firstActiveDayByUser.get(userKey) === dayId) {
      dayRow.newUsers.add(userKey);
    }
    dayRow.transactions += activity.txCount;
    dayRow.basketsMade += activity.basketsMade;
    dayRow.betsPlaced += activity.betsPlaced;
    dayRow.approves += activity.approvesCount;
    dayRow.claims += activity.claimsCount;
    if (activity.basketsMade > 0) {
      basketCreatorsByActivity.add(userKey);
    }

    const agent = ensureTopAgent(activity.user);
    agent.txCount += activity.txCount;
    agent.basketsMade += activity.basketsMade;
    agent.betsPlaced += activity.betsPlaced;
    agent.approvesCount += activity.approvesCount;
    agent.claimsCount += activity.claimsCount;
    agent.activeDays += 1;
  }

  for (const aggregate of dataset.aggregates) {
    const dayId = BigInt(aggregate.dayId);
    if (!isDayInRange(dayId, endDayId, startDayId)) {
      continue;
    }

    const realizedProfit = BigInt(aggregate.realizedProfit);
    ensureDayRow(aggregate.dayId).realizedProfit += realizedProfit;

    const agent = ensureTopAgent(aggregate.user);
    agent.realizedProfit += realizedProfit;
    agent.settledBasketCount += aggregate.basketCount;
  }

  for (const winner of dataset.winners) {
    const dayId = BigInt(winner.dayId);
    if (!isDayInRange(dayId, endDayId, startDayId)) {
      continue;
    }

    const reward = asBigInt(winner.reward);
    const realizedProfit = BigInt(winner.realizedProfit);
    const dayRow = ensureDayRow(winner.dayId);
    dayRow.rewardsPaid += reward;
    dayRow.winnerUser = winner.user;
    dayRow.winnerRealizedProfit = realizedProfit;

    const winnerActivity = activityByDayAndUser.get(
      `${winner.dayId}:${winner.user.toLowerCase()}`,
    );
    dayRow.winnerTxCount = winnerActivity?.txCount ?? 0;

    const agent = ensureTopAgent(winner.user);
    agent.wins += 1;
    agent.rewardsPaid += reward;
  }

  for (const contribution of dataset.contributions) {
    const dayId = BigInt(contribution.dayId);
    if (!isDayInRange(dayId, endDayId, startDayId)) {
      continue;
    }

    const dayRow = ensureDayRow(contribution.dayId);
    dayRow.settledPrincipal += BigInt(contribution.principal);
    dayRow.settledPayout += BigInt(contribution.payout);
    dayRow.settledBasketIds.add(contribution.basketId);
  }

  const dailyRows = Array.from(dayRows.entries())
    .map(([dayId, row]): ProjectStatsDailyRow => ({
      dayId,
      label: getUtcDayLabel(dayId),
      status: row.projection?.status ?? "active",
      settledOnChain: row.projection?.settledOnChain ?? false,
      indexerComplete: row.projection?.indexerComplete ?? false,
      activeAgents: row.activeUsers.size,
      newAgents: row.newUsers.size,
      transactions: row.transactions,
      basketsMade: row.basketsMade,
      betsPlaced: row.betsPlaced,
      approves: row.approves,
      claims: row.claims,
      realizedProfit: row.realizedProfit,
      rewardsPaid: row.rewardsPaid,
      settledPrincipal: row.settledPrincipal,
      settledPayout: row.settledPayout,
      settledBaskets: row.settledBasketIds.size,
      winnerUser: row.winnerUser,
      winnerTxCount: row.winnerTxCount,
      winnerRealizedProfit: row.winnerRealizedProfit,
    }))
    .sort((left, right) => Number(right.dayId) - Number(left.dayId));

  const topAgents = Array.from(topAgentRows.values()).sort((left, right) => {
    if (left.txCount !== right.txCount) {
      return right.txCount - left.txCount;
    }

    if (left.realizedProfit !== right.realizedProfit) {
      return left.realizedProfit > right.realizedProfit ? -1 : 1;
    }

    return left.user.localeCompare(right.user);
  });

  const activeAgents = new Set(topAgents.filter((agent) => agent.txCount > 0).map((agent) => agent.user.toLowerCase()));
  const newAgents = new Set(
    topAgents
      .filter((agent) => {
        if (!agent.firstActiveDayId) {
          return false;
        }

        const firstDayId = BigInt(agent.firstActiveDayId);
        return isDayInRange(firstDayId, endDayId, startDayId) && agent.txCount > 0;
      })
      .map((agent) => agent.user.toLowerCase()),
  );
  const profitableAgents = topAgents.filter((agent) => agent.realizedProfit > 0n);
  const winningAgents = new Set(
    topAgents.filter((agent) => agent.wins > 0).map((agent) => agent.user.toLowerCase()),
  );

  const summary: ProjectStatsSummary = {
    activeAgents: activeAgents.size,
    newAgents: newAgents.size,
    returningAgents: Math.max(activeAgents.size - newAgents.size, 0),
    totalTransactions: dailyRows.reduce((sum, row) => sum + row.transactions, 0),
    totalBasketsMade: dailyRows.reduce((sum, row) => sum + row.basketsMade, 0),
    totalBetsPlaced: dailyRows.reduce((sum, row) => sum + row.betsPlaced, 0),
    totalApproves: dailyRows.reduce((sum, row) => sum + row.approves, 0),
    totalClaims: dailyRows.reduce((sum, row) => sum + row.claims, 0),
    totalRealizedProfit: dailyRows.reduce((sum, row) => sum + row.realizedProfit, 0n),
    totalRewardsPaid: dailyRows.reduce((sum, row) => sum + row.rewardsPaid, 0n),
    totalSettledPrincipal: dailyRows.reduce((sum, row) => sum + row.settledPrincipal, 0n),
    totalSettledPayout: dailyRows.reduce((sum, row) => sum + row.settledPayout, 0n),
    totalSettledBaskets: dailyRows.reduce((sum, row) => sum + row.settledBaskets, 0),
    uniqueBasketCreators: basketCreatorsByActivity.size,
    settledDays: dailyRows.filter((row) => row.settledOnChain).length,
    readyDays: dailyRows.filter((row) => row.status === "ready").length,
    noWinnerDays: dailyRows.filter((row) => row.status === "no_winner").length,
    uniqueWinners: winningAgents.size,
    avgTxPerActiveAgent:
      activeAgents.size > 0
        ? dailyRows.reduce((sum, row) => sum + row.transactions, 0) / activeAgents.size
        : 0,
    avgWinningTxCount:
      dailyRows.filter((row) => row.winnerUser).length > 0
        ? dailyRows
            .filter((row) => row.winnerUser)
            .reduce((sum, row) => sum + row.winnerTxCount, 0) /
          dailyRows.filter((row) => row.winnerUser).length
        : 0,
    avgWinningRealizedProfit:
      dailyRows.filter((row) => row.winnerRealizedProfit !== null).length > 0
        ? dailyRows
            .filter((row) => row.winnerRealizedProfit !== null)
            .reduce((sum, row) => sum + (row.winnerRealizedProfit ?? 0n), 0n) /
          BigInt(dailyRows.filter((row) => row.winnerRealizedProfit !== null).length)
        : 0n,
    profitableAgentShare:
      topAgents.length > 0 ? (profitableAgents.length / topAgents.length) * 100 : 0,
  };

  return {
    range: presetRange ?? "custom",
    fromDayId: startDayId?.toString() ?? null,
    toDayId: endDayId.toString(),
    coverage: {
      firstActivityDayId: coverageFirstDayId,
      lastActivityDayId: coverageLastDayId,
      indexedDays: new Set(dataset.activities.map((item) => item.dayId)).size,
    },
    summary,
    dailyRows,
    topAgents,
  };
};
