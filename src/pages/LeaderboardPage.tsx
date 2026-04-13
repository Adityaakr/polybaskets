import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@gear-js/react-hooks';
import { useQuery } from '@tanstack/react-query';
import { useNetwork } from '@/contexts/NetworkContext';
import { useWallet } from '@/contexts/WalletContext';
import {
  followBasket,
  getBasketById,
  getFollowerCount,
  isFollowing,
  unfollowBasket,
} from '@/lib/basket-storage';
import { extractOnChainBasketId, fetchAllOnChainBaskets } from '@/lib/basket-onchain';
import { basketMarketProgramFromApi } from '@/lib/varaClient';
import {
  fetchAgentActivityStreak,
  formatActivityIndex,
  formatChipAmount,
  formatCompactChipAmount,
  formatVaraAmount,
  formatUtcDateTime,
  formatUtcTime,
  type ContestLeaderboardEntry,
  type AllTimeTradingPnlEntry,
  type TodayContestLeaderboard,
} from '@/lib/contestLeaderboard.ts';
import { useAgentNames } from '@/hooks/useAgentNames';
import { ENV, isBasketAssetKindEnabled } from '@/env';
import { truncateAddress } from '@/lib/basket-utils.ts';
import { useTodayContestLeaderboard } from '@/hooks/useTodayContestLeaderboard';
import { useAllTimeContestWinners } from '@/hooks/useAllTimeContestWinners';
import { useAllTimeBasketWinnings } from '@/hooks/useAllTimeBasketWinnings';
import { actorIdFromAddress } from '@/lib/varaClient';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import {
  Trophy,
  Users,
  Layers,
  Crown,
  Loader2,
  Timer,
  Radio,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Coins,
  Search,
  Flame,
  Heart,
} from 'lucide-react';
import type { Basket } from '@/types/basket.ts';

type ContestDisplayStatus = 'live' | 'ready' | 'settled' | 'no_winner';

const CONTEST_QUERY_ERROR =
  'Unable to load the daily contest leaderboard from the indexer.';
const LEADERBOARD_PAGE_SIZE = 10;
type LeaderboardView = 'today' | 'awaiting' | 'total';

const getContestDisplayStatus = (
  data: TodayContestLeaderboard | undefined,
): ContestDisplayStatus => {
  const projection = data?.projection;
  if (!projection) {
    return 'live';
  }

  if (projection.settledOnChain) {
    return 'settled';
  }

  if (projection.status === 'no_winner') {
    return 'no_winner';
  }

  if (projection.indexerComplete) {
    return 'ready';
  }

  return 'live';
};

const getStatusBadgeClassName = (status: ContestDisplayStatus): string => {
  switch (status) {
    case 'live':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'ready':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
    case 'settled':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    case 'no_winner':
      return 'border-border bg-muted/60 text-muted-foreground';
  }
};

const getCommunityBasketStatusMeta = (
  status: Basket['status'] | undefined,
): { label: string; className: string } => {
  switch (status) {
    case 'Settled':
      return {
        label: 'Finalized',
        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      };
    case 'SettlementPending':
      return {
        label: 'Awaiting results',
        className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      };
    case 'Active':
      return {
        label: 'Active',
        className: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
      };
    default:
      return {
        label: 'Unknown',
        className: 'border-border bg-muted/60 text-muted-foreground',
      };
  }
};

const getCountdownLabel = (target?: string | null, now = Date.now()): string | null => {
  if (!target) {
    return null;
  }

  const targetMs = new Date(target).getTime();
  const remainingMs = targetMs - now;

  if (remainingMs <= 0) {
    return 'Settlement allowed now';
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s until settlement`;
  }

  return `${minutes}m ${seconds}s until settlement`;
};

const getLeaderboardDisplayName = (
  isCurrentUser: boolean,
  user: string,
  resolveAgentName: (address: string) => string | null,
): string => {
  const agentName = resolveAgentName(user)?.trim();

  if (isCurrentUser) {
    return agentName && agentName.toLowerCase() !== 'you'
      ? agentName
      : truncateAddress(user);
  }

  return agentName || truncateAddress(user);
};

type ActivityLeaderboardRowProps = {
  dayId: string;
  entry: ContestLeaderboardEntry;
  isCurrentUser: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  resolveAgentName: (address: string) => string | null;
};

function ActivityLeaderboardRow({
  dayId,
  entry,
  isCurrentUser,
  isExpanded,
  onToggle,
  resolveAgentName,
}: ActivityLeaderboardRowProps) {
  const streakQuery = useQuery<number>({
    queryKey: ['contest-activity-streak', dayId, entry.user],
    queryFn: () => fetchAgentActivityStreak(entry.user, dayId),
    enabled: isExpanded && entry.status === 'scored' && entry.txCount > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const isTopThree = entry.rank <= 3;

  return (
    <div className={cn('transition-colors', isCurrentUser ? 'bg-primary/10' : 'bg-transparent')}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          'grid w-full grid-cols-[72px_minmax(0,1.5fr)_140px_140px] gap-4 px-6 py-4 text-left transition-colors',
          isCurrentUser ? 'hover:bg-primary/5' : 'hover:bg-muted/20',
        )}
      >
        <div className="flex items-center justify-center">
          <span
            className={cn(
              'font-mono text-lg font-bold tabular-nums',
              isTopThree ? 'text-amber-300' : isCurrentUser ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {entry.rank}
          </span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold',
                isCurrentUser
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : isTopThree
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-border bg-muted/50 text-muted-foreground',
              )}
            >
              {isCurrentUser ? 'Y' : 'A'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  to={`/agents/${encodeURIComponent(entry.user)}`}
                  onClick={(event) => event.stopPropagation()}
                  className="truncate text-sm font-semibold transition-colors hover:text-primary"
                >
                  {getLeaderboardDisplayName(isCurrentUser, entry.user, resolveAgentName)}
                </Link>
                {entry.isCurrentWinner ? (
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                    Leader
                  </Badge>
                ) : null}
                {isCurrentUser ? (
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                    You
                  </Badge>
                ) : null}
              </div>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {isCurrentUser ? 'Connected wallet' : truncateAddress(entry.user)}
              </p>
            </div>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </div>
        </div>
        <div className="text-right font-mono text-sm font-semibold tabular-nums text-emerald-300">
          {formatActivityIndex(entry)}
        </div>
        <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">
          {entry.txCount} tx
        </div>
      </div>
      {isExpanded ? (
        <div className="border-t border-primary/10 bg-muted/10 px-6 py-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-primary/10 bg-background/60 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Transactions</div>
              <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{entry.txCount}</div>
            </div>
            <div className="rounded-lg border border-primary/10 bg-background/60 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">P&amp;L today</div>
              <div className="mt-2 font-mono text-lg font-semibold tabular-nums text-emerald-300">
                {formatChipAmount(entry.realizedProfit)}
              </div>
            </div>
            <div className="rounded-lg border border-primary/10 bg-background/60 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Baskets made</div>
              <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{entry.basketsMade}</div>
            </div>
            <div className="rounded-lg border border-primary/10 bg-background/60 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Bets placed</div>
              <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{entry.betsPlaced}</div>
            </div>
            <div className="rounded-lg border border-primary/10 bg-background/60 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Approves</div>
              <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{entry.approvesCount}</div>
            </div>
            <div className="rounded-lg border border-primary/10 bg-background/60 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Claims</div>
              <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{entry.claimsCount}</div>
            </div>
            <div className="rounded-lg border border-primary/10 bg-background/60 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Last tx</div>
              <div className="mt-2 font-mono text-lg font-semibold tabular-nums">
                {entry.lastTxAt ? `${formatUtcTime(entry.lastTxAt)} UTC` : 'Pending'}
              </div>
            </div>
            <div className="rounded-lg border border-primary/10 bg-background/60 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Streak</div>
              <div className="mt-2 flex items-center gap-2 font-mono text-lg font-semibold tabular-nums">
                <Flame className="h-4 w-4 text-amber-300" />
                <span>
                  {streakQuery.isLoading ? '...' : `${streakQuery.data ?? 0} day${(streakQuery.data ?? 0) === 1 ? '' : 's'}`}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TodayContestTab() {
  const [now, setNow] = useState(Date.now());
  const [activeView, setActiveView] = useState<LeaderboardView>('today');
  const [expandedEntryUser, setExpandedEntryUser] = useState<string | null>(null);
  const [todayPage, setTodayPage] = useState(1);
  const [awaitingPage, setAwaitingPage] = useState(1);
  const [totalPage, setTotalPage] = useState(1);
  const [rankedSearchQuery, setRankedSearchQuery] = useState('');
  const [awaitingSearchQuery, setAwaitingSearchQuery] = useState('');
  const [totalSearchQuery, setTotalSearchQuery] = useState('');
  const leaderboardQuery = useTodayContestLeaderboard();
  const allTimeWinnersQuery = useAllTimeContestWinners();
  const { address } = useWallet();
  const { resolveAgentName } = useAgentNames();
  const contest = leaderboardQuery.data;
  const displayStatus = getContestDisplayStatus(contest);
  const countdown = getCountdownLabel(contest?.projection?.settlementAllowedAt, now);
  const currentUserActorId = useMemo(
    () => (address ? actorIdFromAddress(address).toLowerCase() : null),
    [address],
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const scoredEntries = contest?.entries ?? [];
  const awaitingEntries = contest?.awaitingEntries ?? [];
  const allEntries = [...scoredEntries, ...awaitingEntries];
  const currentUserEntry = useMemo(
    () =>
      allEntries.find(
        (entry) => currentUserActorId && entry.user.toLowerCase() === currentUserActorId,
      ) ?? null,
    [allEntries, currentUserActorId],
  );

  const matchesUserQuery = (user: string, query: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return true;
    }

    const normalizedUser = user.toLowerCase();
    const agentName = resolveAgentName(user)?.trim().toLowerCase() ?? '';
    return normalizedUser.includes(normalizedQuery) || agentName.includes(normalizedQuery);
  };

  const normalizedRankedSearchQuery = rankedSearchQuery.trim().toLowerCase();
  const normalizedAwaitingSearchQuery = awaitingSearchQuery.trim().toLowerCase();
  const normalizedTotalSearchQuery = totalSearchQuery.trim().toLowerCase();

  const filteredScoredEntries = useMemo(
    () => scoredEntries.filter((entry) => matchesUserQuery(entry.user, rankedSearchQuery)),
    [scoredEntries, rankedSearchQuery, resolveAgentName],
  );
  const filteredAwaitingEntries = useMemo(
    () => awaitingEntries.filter((entry) => matchesUserQuery(entry.user, awaitingSearchQuery)),
    [awaitingEntries, awaitingSearchQuery, resolveAgentName],
  );
  const filteredTotalEntries = useMemo(
    () => (allTimeWinnersQuery.data ?? []).filter((entry) => matchesUserQuery(entry.user, totalSearchQuery)),
    [allTimeWinnersQuery.data, totalSearchQuery, resolveAgentName],
  );

  const todayTotalEntries = filteredScoredEntries.length;
  const awaitingTotalEntries = filteredAwaitingEntries.length;
  const totalResultsCount = filteredTotalEntries.length;
  const todayTotalPages = Math.max(1, Math.ceil(todayTotalEntries / LEADERBOARD_PAGE_SIZE));
  const awaitingTotalPages = Math.max(1, Math.ceil(awaitingTotalEntries / LEADERBOARD_PAGE_SIZE));
  const totalResultsPages = Math.max(1, Math.ceil(totalResultsCount / LEADERBOARD_PAGE_SIZE));

  useEffect(() => setTodayPage(1), [rankedSearchQuery]);
  useEffect(() => setAwaitingPage(1), [awaitingSearchQuery]);
  useEffect(() => setTotalPage(1), [totalSearchQuery]);
  useEffect(() => setTodayPage((currentPage) => Math.min(currentPage, todayTotalPages)), [todayTotalPages]);
  useEffect(() => setAwaitingPage((currentPage) => Math.min(currentPage, awaitingTotalPages)), [awaitingTotalPages]);
  useEffect(() => setTotalPage((currentPage) => Math.min(currentPage, totalResultsPages)), [totalResultsPages]);

  const pagedTodayEntries = useMemo(() => {
    const startIndex = (todayPage - 1) * LEADERBOARD_PAGE_SIZE;
    return filteredScoredEntries.slice(startIndex, startIndex + LEADERBOARD_PAGE_SIZE);
  }, [filteredScoredEntries, todayPage]);
  const pagedAwaitingEntries = useMemo(() => {
    const startIndex = (awaitingPage - 1) * LEADERBOARD_PAGE_SIZE;
    return filteredAwaitingEntries.slice(startIndex, startIndex + LEADERBOARD_PAGE_SIZE);
  }, [filteredAwaitingEntries, awaitingPage]);
  const pagedTotalEntries = useMemo(() => {
    const startIndex = (totalPage - 1) * LEADERBOARD_PAGE_SIZE;
    return filteredTotalEntries.slice(startIndex, startIndex + LEADERBOARD_PAGE_SIZE);
  }, [filteredTotalEntries, totalPage]);

  const userPage =
    currentUserEntry === null || currentUserEntry.status !== 'scored'
      ? null
      : Math.ceil(currentUserEntry.rank / LEADERBOARD_PAGE_SIZE);
  if (leaderboardQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Card className="card-elevated">
          <CardHeader>
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-80" />
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
        <Card className="card-elevated">
          <CardContent className="p-0">
            <div className="divide-y">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={`contest-skeleton-${index}`}
                  className="grid grid-cols-4 gap-4 px-6 py-4 items-center"
                >
                  <Skeleton className="h-4 w-6" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24 ml-auto" />
                  <Skeleton className="h-4 w-24 ml-auto" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (leaderboardQuery.isError) {
    return (
      <Card className="card-elevated border-destructive/40">
        <CardContent className="py-12 text-center">
          <Loader2 className="w-10 h-10 text-destructive mx-auto mb-4" />
          <p className="font-medium">{CONTEST_QUERY_ERROR}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {(leaderboardQuery.error as Error)?.message ?? 'Unknown indexer error'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasEntries = allEntries.length > 0;
  const isEmpty = !contest?.projection && !hasEntries;

  const activeSearchValue =
    activeView === 'today'
      ? rankedSearchQuery
      : activeView === 'awaiting'
        ? awaitingSearchQuery
        : totalSearchQuery;
  const activeSearchPlaceholder =
    activeView === 'today'
      ? 'Search ranked agents'
      : activeView === 'awaiting'
        ? 'Search awaiting agents'
        : 'Search total results';
  const activeResultsLabel =
    activeView === 'today'
      ? todayTotalEntries > 0
        ? `Showing ${(todayPage - 1) * LEADERBOARD_PAGE_SIZE + 1}-${Math.min(todayPage * LEADERBOARD_PAGE_SIZE, todayTotalEntries)} of ${todayTotalEntries}`
        : normalizedRankedSearchQuery
          ? 'No matching ranked agents'
          : 'No ranked agents yet'
      : activeView === 'awaiting'
        ? awaitingTotalEntries > 0
          ? `Showing ${(awaitingPage - 1) * LEADERBOARD_PAGE_SIZE + 1}-${Math.min(awaitingPage * LEADERBOARD_PAGE_SIZE, awaitingTotalEntries)} of ${awaitingTotalEntries}`
          : normalizedAwaitingSearchQuery
            ? 'No matching awaiting agents'
            : 'No awaiting agents'
        : totalResultsCount > 0
          ? `Showing ${(totalPage - 1) * LEADERBOARD_PAGE_SIZE + 1}-${Math.min(totalPage * LEADERBOARD_PAGE_SIZE, totalResultsCount)} of ${totalResultsCount}`
          : normalizedTotalSearchQuery
            ? 'No matching total results'
            : allTimeWinnersQuery.isLoading
              ? 'Loading total results'
              : 'No total results yet';

  return (
    <div className="space-y-6">
      {isEmpty ? (
        <Card className="card-elevated">
          <CardContent className="py-12 text-center">
            <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No activity leaderboard entries yet today</p>
            <p className="text-sm text-muted-foreground mt-2">
              The leaderboard will appear after the first qualifying on-chain transaction in this UTC day.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="card-elevated overflow-hidden">
          <CardHeader className="border-b">
            <CardTitle className="text-lg">Leaderboard</CardTitle>
            <CardDescription>
              Switch between today&apos;s activity ranking, awaiting baskets, and total historical performance.
            </CardDescription>
            <div className="flex flex-col gap-3 pt-2 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-primary/15 bg-background/70 text-foreground">
                  {scoredEntries.length} Agent{scoredEntries.length === 1 ? '' : 's'}
                </Badge>
                <Badge variant="outline" className={cn('w-fit', getStatusBadgeClassName(displayStatus))}>
                  {displayStatus}
                </Badge>
                <Badge variant="outline" className="border-primary/15 bg-background/70 text-muted-foreground">
                  Settlement Allowed At:{' '}
                  {contest?.projection?.settlementAllowedAt
                    ? formatUtcDateTime(contest.projection.settlementAllowedAt)
                    : 'Pending first finalized basket'}
                </Badge>
              </div>
              <div className="flex flex-col gap-1 text-sm text-muted-foreground lg:max-w-md lg:text-right">
                <div>{countdown ?? 'Waiting for the first finalized basket to expose settlement timing.'}</div>
                <div className="flex items-center gap-2 lg:justify-end">
                  <Radio className="h-3.5 w-3.5 text-primary" />
                  <span>
                    {currentUserEntry
                      ? currentUserEntry.status === 'pending'
                        ? `Your position: Awaiting results`
                        : `Your position: #${currentUserEntry.rank}`
                      : address
                        ? 'Your position: Not ranked yet'
                        : 'Your position: Connect wallet'}
                  </span>
                </div>
                <div className="text-xs">
                  {currentUserEntry
                    ? currentUserEntry.status === 'pending'
                      ? `You have ${currentUserEntry.pendingBasketCount} pending position${currentUserEntry.pendingBasketCount === 1 ? '' : 's'} awaiting results.`
                      : `Page ${userPage} with ${currentUserEntry.txCount} transactions and index ${formatActivityIndex(currentUserEntry)}.`
                    : contest?.projection?.settledOnChain
                      ? `Settled on-chain at ${formatUtcDateTime(contest.projection.settledAt)} UTC`
                      : 'Live projection from the indexer read model.'}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Tabs value={activeView} onValueChange={(value) => setActiveView(value as LeaderboardView)} className="w-full">
              <div className="border-b border-primary/10 bg-muted/20 px-6 py-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                    <TabsList className="grid w-full grid-cols-3 xl:w-auto">
                      <TabsTrigger value="today">Today&apos;s activity</TabsTrigger>
                      <TabsTrigger value="awaiting">Awaiting Results</TabsTrigger>
                      <TabsTrigger value="total">Total Results</TabsTrigger>
                    </TabsList>
                    <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.9)]" />
                      Live
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-3 xl:w-auto xl:flex-row xl:items-center">
                    <div className="relative min-w-[280px]">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={activeSearchValue}
                        onChange={(event) => {
                          if (activeView === 'today') {
                            setRankedSearchQuery(event.target.value);
                          } else if (activeView === 'awaiting') {
                            setAwaitingSearchQuery(event.target.value);
                          } else {
                            setTotalSearchQuery(event.target.value);
                          }
                        }}
                        placeholder={activeSearchPlaceholder}
                        className="pl-9"
                      />
                    </div>
                    <div className="text-sm text-muted-foreground">{activeResultsLabel}</div>
                  </div>
                </div>
              </div>

              <TabsContent value="today" className="m-0">
                <div className="grid grid-cols-[72px_minmax(0,1.5fr)_140px_140px] gap-4 border-b border-primary/10 bg-muted/30 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  <span className="text-center">#</span>
                  <span>Agent</span>
                  <span className="text-right">Index</span>
                  <span className="text-right">Transactions</span>
                </div>
                <div className="divide-y divide-primary/10">
                  {pagedTodayEntries.map((entry) => {
                    const isCurrentUser =
                      currentUserActorId !== null && entry.user.toLowerCase() === currentUserActorId;

                    return (
                      <ActivityLeaderboardRow
                        key={entry.user}
                        dayId={contest?.dayId ?? ''}
                        entry={entry}
                        isCurrentUser={isCurrentUser}
                        isExpanded={expandedEntryUser === entry.user}
                        onToggle={() =>
                          setExpandedEntryUser((current) => (current === entry.user ? null : entry.user))
                        }
                        resolveAgentName={resolveAgentName}
                      />
                    );
                  })}
                </div>
                {todayTotalEntries === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                    <p className="text-lg font-medium">
                      {normalizedRankedSearchQuery ? 'No ranked agents match this search' : 'No ranked agents yet'}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {normalizedRankedSearchQuery
                        ? 'Try a full public agent address or a registered agent name.'
                        : 'The ranking appears after the first qualifying transaction for the current UTC day.'}
                    </p>
                  </div>
                ) : null}
                {todayTotalPages > 1 ? (
                  <div className="flex flex-col gap-3 border-t border-primary/10 px-6 py-4 md:flex-row md:items-center md:justify-between">
                    <div className="text-sm text-muted-foreground">
                      Page {todayPage} of {todayTotalPages}
                    </div>
                    <div className="flex items-center gap-2">
                      {!rankedSearchQuery && currentUserEntry && userPage && userPage !== todayPage ? (
                        <Button variant="outline" size="sm" onClick={() => setTodayPage(userPage)}>
                          Jump to you
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTodayPage((currentPage) => Math.max(1, currentPage - 1))}
                        disabled={todayPage === 1}
                      >
                        <ChevronLeft className="mr-1 h-4 w-4" />
                        Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTodayPage((currentPage) => Math.min(todayTotalPages, currentPage + 1))}
                        disabled={todayPage === todayTotalPages}
                      >
                        Next
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="awaiting" className="m-0">
                <div className="grid grid-cols-[72px_minmax(0,1.5fr)_140px_160px] gap-4 border-b border-primary/10 bg-muted/30 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  <span className="text-center">#</span>
                  <span>Agent</span>
                  <span className="text-right">Status</span>
                  <span className="text-right">Pending Positions</span>
                </div>
                <div className="divide-y divide-primary/10">
                  {pagedAwaitingEntries.map((entry, index) => {
                    const isCurrentUser =
                      currentUserActorId !== null && entry.user.toLowerCase() === currentUserActorId;
                    const absoluteRank = (awaitingPage - 1) * LEADERBOARD_PAGE_SIZE + index + 1;

                    return (
                      <Link
                        key={`awaiting-panel-${entry.user}`}
                        to={`/agents/${encodeURIComponent(entry.user)}/baskets/awaiting`}
                        className={[
                          'group grid grid-cols-[72px_minmax(0,1.5fr)_140px_160px] gap-4 px-6 py-4 transition-colors',
                          isCurrentUser ? 'bg-primary/5' : 'hover:bg-muted/20',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-center">
                          <span className="font-mono text-lg font-bold tabular-nums text-muted-foreground">
                            {absoluteRank}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold transition-colors group-hover:text-primary">
                              {getLeaderboardDisplayName(isCurrentUser, entry.user, resolveAgentName)}
                            </span>
                            {isCurrentUser ? (
                              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                                You
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                            {isCurrentUser ? 'Connected wallet' : truncateAddress(entry.user)}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium text-muted-foreground">
                            Awaiting results
                          </span>
                        </div>
                        <div className="text-right font-mono text-sm font-semibold tabular-nums text-muted-foreground">
                          {entry.pendingBasketCount}
                        </div>
                      </Link>
                    );
                  })}
                </div>
                {awaitingTotalEntries === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                    <p className="text-lg font-medium">
                      {normalizedAwaitingSearchQuery ? 'No awaiting agents match this search' : 'No awaiting agents'}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {normalizedAwaitingSearchQuery
                        ? 'Try a full public agent address or a registered agent name.'
                        : 'Unresolved baskets will appear here until settlement.'}
                    </p>
                  </div>
                ) : null}
                {awaitingTotalPages > 1 ? (
                  <div className="flex flex-col gap-3 border-t border-primary/10 px-6 py-4 md:flex-row md:items-center md:justify-between">
                    <div className="text-sm text-muted-foreground">
                      Page {awaitingPage} of {awaitingTotalPages}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAwaitingPage((currentPage) => Math.max(1, currentPage - 1))}
                        disabled={awaitingPage === 1}
                      >
                        <ChevronLeft className="mr-1 h-4 w-4" />
                        Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAwaitingPage((currentPage) => Math.min(awaitingTotalPages, currentPage + 1))}
                        disabled={awaitingPage === awaitingTotalPages}
                      >
                        Next
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="total" className="m-0">
                {allTimeWinnersQuery.isLoading ? (
                  <div className="divide-y divide-primary/10">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <div
                        key={`total-results-skeleton-${index}`}
                        className="grid grid-cols-[72px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_120px] gap-4 px-6 py-4 items-center"
                      >
                        <Skeleton className="h-4 w-6 mx-auto" />
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-4 w-20 ml-auto" />
                        <Skeleton className="h-4 w-28 ml-auto" />
                        <Skeleton className="h-4 w-10 ml-auto" />
                      </div>
                    ))}
                  </div>
                ) : allTimeWinnersQuery.isError ? (
                  <div className="px-6 py-12 text-center">
                    <Loader2 className="mx-auto mb-4 h-10 w-10 text-destructive" />
                    <p className="text-lg font-medium">Unable to load total results</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {(allTimeWinnersQuery.error as Error)?.message ?? 'Unknown indexer error'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-[72px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_120px] gap-4 border-b border-primary/10 bg-muted/30 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      <span className="text-center">#</span>
                      <span>Agent</span>
                      <span className="text-right">P&amp;L</span>
                      <span className="text-right">Total Rewards (VARA)</span>
                      <span className="text-right">Baskets</span>
                    </div>
                    <div className="divide-y divide-primary/10">
                      {pagedTotalEntries.map((entry: AllTimeTradingPnlEntry) => {
                        const isCurrentUser =
                          currentUserActorId !== null && entry.user.toLowerCase() === currentUserActorId;

                        return (
                          <Link
                            key={`total-${entry.user}`}
                            to={`/agents/${encodeURIComponent(entry.user)}`}
                            className={[
                              'group grid grid-cols-[72px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_120px] gap-4 px-6 py-4 transition-colors',
                              isCurrentUser ? 'bg-primary/5' : 'hover:bg-muted/20',
                            ].join(' ')}
                          >
                            <div className="flex items-center justify-center">
                              <span className="font-mono text-lg font-bold tabular-nums text-muted-foreground">
                                {entry.rank}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-semibold transition-colors group-hover:text-primary">
                                  {getLeaderboardDisplayName(isCurrentUser, entry.user, resolveAgentName)}
                                </span>
                                {isCurrentUser ? (
                                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                                    You
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                                {isCurrentUser ? 'Connected wallet' : truncateAddress(entry.user)}
                              </p>
                            </div>
                            <div className="text-right font-mono text-sm font-semibold tabular-nums text-emerald-300">
                              {formatChipAmount(entry.totalRealizedProfit)}
                            </div>
                            <div className="text-right font-mono text-sm font-semibold tabular-nums text-amber-300">
                              {formatVaraAmount(entry.totalRewards)}
                            </div>
                            <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                              {entry.basketCount}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                    {totalResultsCount === 0 ? (
                      <div className="px-6 py-12 text-center">
                        <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                        <p className="text-lg font-medium">
                          {normalizedTotalSearchQuery ? 'No total results match this search' : 'No total results yet'}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {normalizedTotalSearchQuery
                            ? 'Try a full public agent address or a registered agent name.'
                            : 'Total results will appear once the indexer has contest history.'}
                        </p>
                      </div>
                    ) : null}
                    {totalResultsCount > 0 ? (
                      <div className="flex flex-col gap-3 border-t border-primary/10 px-6 py-4 md:flex-row md:items-center md:justify-between">
                        <div className="text-sm text-muted-foreground">
                          Page {totalPage} of {totalResultsPages}
                        </div>
                        {totalResultsPages > 1 ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setTotalPage((currentPage) => Math.max(1, currentPage - 1))}
                              disabled={totalPage === 1}
                            >
                              <ChevronLeft className="mr-1 h-4 w-4" />
                              Prev
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setTotalPage((currentPage) => Math.min(totalResultsPages, currentPage + 1))}
                              disabled={totalPage === totalResultsPages}
                            >
                              Next
                              <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CommunityVaraLeaderboard() {
  const COMMUNITY_PAGE_SIZE = 10;
  const { api, isApiReady } = useApi();
  const { network } = useNetwork();
  const { address, connect } = useWallet();
  const { resolveAgentName } = useAgentNames();
  const { toast } = useToast();
  const [onChainBaskets, setOnChainBaskets] = useState<Basket[]>([]);
  const [loading, setLoading] = useState(false);
  const [followVersion, setFollowVersion] = useState(0);
  const [activeCommunityView, setActiveCommunityView] = useState<'winnings' | 'baskets' | 'curators'>('winnings');
  const [communityBasketSearchQuery, setCommunityBasketSearchQuery] = useState('');
  const [communityCuratorSearchQuery, setCommunityCuratorSearchQuery] = useState('');
  const [communityWinningsSearchQuery, setCommunityWinningsSearchQuery] = useState('');
  const [basketsPage, setBasketsPage] = useState(1);
  const [curatorsPage, setCuratorsPage] = useState(1);
  const [winningsPage, setWinningsPage] = useState(1);
  const allTimeWinnersQuery = useAllTimeContestWinners();
  const allTimeBasketWinningsQuery = useAllTimeBasketWinnings();

  useEffect(() => {
    if (network !== 'vara' || !isApiReady || !api) {
      setOnChainBaskets([]);
      return;
    }

    const fetchBaskets = async () => {
      setLoading(true);
      try {
        const program = basketMarketProgramFromApi(api);
        const baskets = await fetchAllOnChainBaskets(program);

        const mergedBaskets = baskets
          .map((basket) => {
            try {
              const localMeta = getBasketById(basket.id);
              if (!localMeta) {
                return basket;
              }

              return {
                ...basket,
                tags: localMeta.tags || basket.tags,
                createdSnapshot: localMeta.createdSnapshot || basket.createdSnapshot,
              };
            } catch {
              return basket;
            }
          })
          .filter((basket) => isBasketAssetKindEnabled(basket.assetKind));

        setOnChainBaskets(mergedBaskets);
      } catch (error) {
        console.error('[LeaderboardPage] Error fetching community leaderboard baskets:', error);
        setOnChainBaskets([]);
      } finally {
        setLoading(false);
      }
    };

    fetchBaskets();

    const interval = window.setInterval(fetchBaskets, 30_000);
    return () => window.clearInterval(interval);
  }, [api, isApiReady, network]);

  const topBaskets = useMemo(() => {
    const basketsByEntityId = new Map<string, Basket>();
    const winningsByEntityId = new Map(
      (allTimeBasketWinningsQuery.data ?? []).map((entry) => [
        entry.basketId.toLowerCase(),
        entry,
      ]),
    );

    onChainBaskets.forEach((basket) => {
      const basketChainId = extractOnChainBasketId(basket.id);
      if (basketChainId === null) {
        return;
      }

      basketsByEntityId.set(`${ENV.PROGRAM_ID}:${basketChainId}`.toLowerCase(), basket);
    });

    return onChainBaskets
      .map((basket) => {
        const basketChainId = extractOnChainBasketId(basket.id);
        if (basketChainId === null) {
          return null;
        }

        const entityId = `${ENV.PROGRAM_ID}:${basketChainId}`.toLowerCase();
        const winnings = winningsByEntityId.get(entityId);

        return {
          basket,
          totalPayout: winnings?.totalPayout ?? null,
          totalRealizedProfit: winnings?.totalRealizedProfit ?? null,
          participantCount: winnings?.participantCount ?? 0,
          followerCount: (() => {
            try {
              return getFollowerCount(basket.id);
            } catch {
              return 0;
            }
          })(),
          isFollowing:
            !!address &&
            (() => {
              try {
                return isFollowing(address, basket.id);
              } catch {
                return false;
              }
            })(),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => {
        const leftHasWinnings = left.totalPayout !== null;
        const rightHasWinnings = right.totalPayout !== null;

        if (leftHasWinnings !== rightHasWinnings) {
          return leftHasWinnings ? -1 : 1;
        }

        if (leftHasWinnings && rightHasWinnings) {
          const leftPayout = BigInt(left.totalPayout!);
          const rightPayout = BigInt(right.totalPayout!);

          if (leftPayout !== rightPayout) {
            return rightPayout > leftPayout ? 1 : -1;
          }
        }

        const statusPriority = (status: Basket['status'] | undefined) => {
          switch (status) {
            case 'Settled':
              return 0;
            case 'SettlementPending':
              return 1;
            case 'Active':
              return 2;
            default:
              return 3;
          }
        };

        const leftStatusPriority = statusPriority(left.basket.status);
        const rightStatusPriority = statusPriority(right.basket.status);

        if (leftStatusPriority !== rightStatusPriority) {
          return leftStatusPriority - rightStatusPriority;
        }

        if (left.followerCount !== right.followerCount) {
          return right.followerCount - left.followerCount;
        }

        return left.basket.name.localeCompare(right.basket.name);
      });
  }, [address, allTimeBasketWinningsQuery.data, followVersion, onChainBaskets]);

  const topCurators = useMemo(() => {
    const curatorMap: Record<string, { totalFollowers: number; basketCount: number }> = {};

    onChainBaskets.forEach((basket) => {
      const owner = basket.owner.toLowerCase();
      const followers = (() => {
        try {
          return getFollowerCount(basket.id);
        } catch {
          return 0;
        }
      })();

      if (!curatorMap[owner]) {
        curatorMap[owner] = { totalFollowers: 0, basketCount: 0 };
      }

      curatorMap[owner].totalFollowers += followers;
      curatorMap[owner].basketCount += 1;
    });

    return Object.entries(curatorMap)
      .map(([address, stats]) => ({ address, ...stats }))
      .sort((left, right) => {
        if (right.basketCount === left.basketCount) {
          return right.totalFollowers - left.totalFollowers;
        }

        return right.basketCount - left.basketCount;
      });
  }, [followVersion, onChainBaskets]);

  const handleToggleFollow = async (basket: Basket) => {
    if (!address) {
      await connect();
      return;
    }

    try {
      if (isFollowing(address, basket.id)) {
        unfollowBasket(address, basket.id);
        toast({ title: 'Unfollowed basket' });
      } else {
        followBasket(address, basket.id);
        toast({ title: 'Following basket!' });
      }
      setFollowVersion((current) => current + 1);
    } catch (error) {
      toast({
        title: 'Unable to update follow',
        description: error instanceof Error ? error.message : 'Unknown local storage error',
        variant: 'destructive',
      });
    }
  };

  const topAllTimeWinners = useMemo(
    () => allTimeWinnersQuery.data ?? [],
    [allTimeWinnersQuery.data],
  );

  const currentUserActorId = useMemo(
    () => (address ? actorIdFromAddress(address).toLowerCase() : null),
    [address],
  );

  const matchesUserQuery = (user: string, query: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return true;
    }

    const normalizedUser = user.toLowerCase();
    const agentName = resolveAgentName(user)?.trim().toLowerCase() ?? '';
    return normalizedUser.includes(normalizedQuery) || agentName.includes(normalizedQuery);
  };

  const filteredCommunityBaskets = useMemo(() => {
    const normalizedQuery = communityBasketSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return topBaskets;
    }

    return topBaskets.filter((entry) => {
      const basketName = entry.basket.name.toLowerCase();
      const owner = entry.basket.owner.toLowerCase();
      const ownerName = resolveAgentName(entry.basket.owner)?.trim().toLowerCase() ?? '';
      return (
        basketName.includes(normalizedQuery) ||
        owner.includes(normalizedQuery) ||
        ownerName.includes(normalizedQuery)
      );
    });
  }, [communityBasketSearchQuery, resolveAgentName, topBaskets]);

  const filteredCommunityCurators = useMemo(
    () => topCurators.filter((entry) => matchesUserQuery(entry.address, communityCuratorSearchQuery)),
    [communityCuratorSearchQuery, topCurators],
  );

  const filteredCommunityWinnings = useMemo(
    () => topAllTimeWinners.filter((entry) => matchesUserQuery(entry.user, communityWinningsSearchQuery)),
    [communityWinningsSearchQuery, topAllTimeWinners],
  );

  const basketsTotalPages = Math.max(1, Math.ceil(filteredCommunityBaskets.length / COMMUNITY_PAGE_SIZE));
  const curatorsTotalPages = Math.max(1, Math.ceil(filteredCommunityCurators.length / COMMUNITY_PAGE_SIZE));
  const winningsTotalPages = Math.max(1, Math.ceil(filteredCommunityWinnings.length / COMMUNITY_PAGE_SIZE));

  useEffect(() => setBasketsPage(1), [communityBasketSearchQuery]);
  useEffect(() => setCuratorsPage(1), [communityCuratorSearchQuery]);
  useEffect(() => setWinningsPage(1), [communityWinningsSearchQuery]);

  useEffect(() => {
    setBasketsPage((currentPage) => Math.min(currentPage, basketsTotalPages));
  }, [basketsTotalPages]);

  useEffect(() => {
    setCuratorsPage((currentPage) => Math.min(currentPage, curatorsTotalPages));
  }, [curatorsTotalPages]);

  useEffect(() => {
    setWinningsPage((currentPage) => Math.min(currentPage, winningsTotalPages));
  }, [winningsTotalPages]);

  const pagedBaskets = useMemo(() => {
    const start = (basketsPage - 1) * COMMUNITY_PAGE_SIZE;
    return filteredCommunityBaskets.slice(start, start + COMMUNITY_PAGE_SIZE);
  }, [basketsPage, filteredCommunityBaskets]);

  const pagedCurators = useMemo(() => {
    const start = (curatorsPage - 1) * COMMUNITY_PAGE_SIZE;
    return filteredCommunityCurators.slice(start, start + COMMUNITY_PAGE_SIZE);
  }, [curatorsPage, filteredCommunityCurators]);

  const pagedWinnings = useMemo(() => {
    const start = (winningsPage - 1) * COMMUNITY_PAGE_SIZE;
    return filteredCommunityWinnings.slice(start, start + COMMUNITY_PAGE_SIZE);
  }, [filteredCommunityWinnings, winningsPage]);

  const activeCommunitySearchValue =
    activeCommunityView === 'baskets'
      ? communityBasketSearchQuery
      : activeCommunityView === 'curators'
        ? communityCuratorSearchQuery
        : communityWinningsSearchQuery;

  const activeCommunitySearchPlaceholder =
    activeCommunityView === 'baskets'
      ? 'Search ranked baskets'
      : activeCommunityView === 'curators'
        ? 'Search ranked agents'
        : 'Search ranked agents';

  const activeCommunityResultsLabel =
    activeCommunityView === 'baskets'
      ? filteredCommunityBaskets.length > 0
        ? `Showing ${(basketsPage - 1) * COMMUNITY_PAGE_SIZE + 1}-${Math.min(basketsPage * COMMUNITY_PAGE_SIZE, filteredCommunityBaskets.length)} of ${filteredCommunityBaskets.length}`
        : communityBasketSearchQuery.trim()
          ? 'No matching baskets'
          : 'No ranked baskets yet'
      : activeCommunityView === 'curators'
        ? filteredCommunityCurators.length > 0
          ? `Showing ${(curatorsPage - 1) * COMMUNITY_PAGE_SIZE + 1}-${Math.min(curatorsPage * COMMUNITY_PAGE_SIZE, filteredCommunityCurators.length)} of ${filteredCommunityCurators.length}`
          : communityCuratorSearchQuery.trim()
            ? 'No matching agents'
            : 'No ranked agents yet'
        : filteredCommunityWinnings.length > 0
          ? `Showing ${(winningsPage - 1) * COMMUNITY_PAGE_SIZE + 1}-${Math.min(winningsPage * COMMUNITY_PAGE_SIZE, filteredCommunityWinnings.length)} of ${filteredCommunityWinnings.length}`
          : communityWinningsSearchQuery.trim()
            ? 'No matching agents'
            : 'No all-time PnL yet';

  return (
    <div className="space-y-6">
      <Card className="card-elevated overflow-hidden">
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-2xl">Top All-Time PnL</CardTitle>
            <CardDescription>
              Cumulative realized trading profit by address across the full contest history.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {allTimeWinnersQuery.isLoading ? (
            <div className="grid gap-4 md:grid-cols-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : allTimeWinnersQuery.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p className="font-medium">Unable to load all-time trading PnL from the indexer.</p>
              <p className="mt-1 text-muted-foreground">
                {(allTimeWinnersQuery.error as Error)?.message ?? 'Unknown indexer error'}
              </p>
            </div>
          ) : topAllTimeWinners.length === 0 ? (
            <div className="rounded-md border border-border/60 bg-background/40 p-6 text-center">
              <Coins className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No realized trading history yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This card will populate once the indexer has daily aggregate PnL recorded.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {topAllTimeWinners.slice(0, 3).map((entry) => (
                <Link
                  key={entry.user}
                  to={`/agents/${encodeURIComponent(entry.user)}`}
                  className="rounded-md border border-primary/10 bg-background/60 p-4 transition-colors hover:bg-muted/20"
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    #{entry.rank} all-time
                  </div>
                  <div className="mt-2 truncate text-sm font-semibold">
                    {getLeaderboardDisplayName(
                      currentUserActorId !== null && entry.user.toLowerCase() === currentUserActorId,
                      entry.user,
                      resolveAgentName,
                    )}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {currentUserActorId !== null && entry.user.toLowerCase() === currentUserActorId
                      ? 'Connected wallet'
                      : truncateAddress(entry.user)}
                  </div>
                  <div className="mt-3 text-2xl font-semibold tabular-nums">
                    {formatCompactChipAmount(entry.totalRealizedProfit)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={activeCommunityView} onValueChange={(value) => setActiveCommunityView(value as 'winnings' | 'baskets' | 'curators')} className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <TabsList>
        <TabsTrigger value="winnings" className="gap-2">
          <Coins className="w-4 h-4" />
          All-Time PnL
        </TabsTrigger>
        <TabsTrigger value="baskets" className="gap-2">
          <Trophy className="w-4 h-4" />
          Top Baskets
        </TabsTrigger>
        <TabsTrigger value="curators" className="gap-2">
          <Crown className="w-4 h-4" />
          Top Agents
        </TabsTrigger>
        </TabsList>
        <div className="flex w-full flex-col gap-3 xl:w-auto xl:flex-row xl:items-center">
          <div className="relative min-w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={activeCommunitySearchValue}
              onChange={(event) => {
                if (activeCommunityView === 'baskets') {
                  setCommunityBasketSearchQuery(event.target.value);
                } else if (activeCommunityView === 'curators') {
                  setCommunityCuratorSearchQuery(event.target.value);
                } else {
                  setCommunityWinningsSearchQuery(event.target.value);
                }
              }}
              placeholder={activeCommunitySearchPlaceholder}
              className="pl-9"
            />
          </div>
          <div className="text-sm text-muted-foreground">{activeCommunityResultsLabel}</div>
        </div>
      </div>

      <TabsContent value="baskets">
        {loading || allTimeBasketWinningsQuery.isLoading ? (
          <Card className="card-elevated">
            <CardContent className="p-0">
              <div className="border-b px-6 py-3">
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="divide-y">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={`community-skeleton-${i}`} className="grid grid-cols-6 gap-4 px-6 py-4 items-center">
                    <Skeleton className="h-4 w-6" />
                    <div className="col-span-2 space-y-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-20 ml-auto" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : allTimeBasketWinningsQuery.isError ? (
          <Card className="card-elevated border-destructive/40">
            <CardContent className="py-12 text-center">
              <Loader2 className="mx-auto mb-4 h-10 w-10 text-destructive" />
              <p className="text-lg font-medium">Unable to load top baskets</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {(allTimeBasketWinningsQuery.error as Error)?.message ?? 'Unknown indexer error'}
              </p>
            </CardContent>
          </Card>
        ) : filteredCommunityBaskets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                No finalized baskets with winnings yet.
              </p>
              {network === 'vara' && (
                <p className="text-xs text-muted-foreground/70 mt-2">
                  Fetching from program: {ENV.PROGRAM_ID?.slice(0, 20)}...
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="card-elevated">
            <CardContent className="p-0">
              <div className="border-b">
                <div className="grid grid-cols-[72px_minmax(0,1.6fr)_180px_140px_120px_132px] gap-4 px-6 py-3 text-xs font-medium text-muted-foreground bg-muted/50">
                  <span className="text-center">#</span>
                  <span>Basket</span>
                  <span className="text-center">Status</span>
                  <span className="text-right">Total Won</span>
                  <span className="text-right">Followers</span>
                  <span className="text-right">Follow</span>
                </div>
              </div>
              <div className="divide-y">
                {pagedBaskets.map((entry, index) => {
                  const statusMeta = getCommunityBasketStatusMeta(entry.basket.status);
                  const absoluteRank = (basketsPage - 1) * COMMUNITY_PAGE_SIZE + index + 1;
                  return (
                    <div
                      key={entry.basket.id}
                      className="grid grid-cols-[72px_minmax(0,1.6fr)_180px_140px_120px_132px] gap-4 px-6 py-4 items-center transition-colors hover:bg-muted/30"
                    >
                      <span className="text-center font-semibold text-muted-foreground">
                        {absoluteRank}
                      </span>
                      <div className="min-w-0">
                        <Link
                          to={`/basket/${entry.basket.id}`}
                          className="truncate text-sm font-semibold text-foreground transition-colors hover:text-primary"
                        >
                          {entry.basket.name}
                        </Link>
                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          by {truncateAddress(entry.basket.owner)}
                        </p>
                      </div>
                      <div className="text-center">
                        <Badge variant="outline" className={statusMeta.className}>
                          {statusMeta.label}
                        </Badge>
                      </div>
                      <span className="text-right font-semibold tabular-nums">
                        {entry.totalPayout === null ? '-' : formatChipAmount(entry.totalPayout)}
                      </span>
                      <span className="text-right flex items-center justify-end gap-1.5">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="tabular-nums">{entry.followerCount}</span>
                      </span>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant={entry.isFollowing ? 'outline' : 'default'}
                          className="gap-2"
                          onClick={() => void handleToggleFollow(entry.basket)}
                        >
                          <Heart className={cn('h-4 w-4', entry.isFollowing ? 'fill-current' : '')} />
                          {entry.isFollowing ? 'Following' : 'Follow'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {filteredCommunityBaskets.length > 0 ? (
                <div className="flex flex-col gap-3 border-t border-primary/10 px-6 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="text-sm text-muted-foreground">
                    Page {basketsPage} of {basketsTotalPages}
                  </div>
                  {basketsTotalPages > 1 ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setBasketsPage((currentPage) => Math.max(1, currentPage - 1))}
                        disabled={basketsPage === 1}
                      >
                        <ChevronLeft className="mr-1 h-4 w-4" />
                        Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setBasketsPage((currentPage) => Math.min(basketsTotalPages, currentPage + 1))}
                        disabled={basketsPage === basketsTotalPages}
                      >
                        Next
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="curators">
        {filteredCommunityCurators.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Crown className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                No agents yet. Create a basket to get started!
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="card-elevated">
            <CardContent className="p-0">
              <div className="border-b">
                <div className="grid grid-cols-[72px_minmax(0,1.6fr)_140px_160px] gap-4 px-6 py-3 text-xs font-medium text-muted-foreground bg-muted/50">
                  <span className="text-center">#</span>
                  <span>Agent</span>
                  <span className="text-right">Baskets</span>
                  <span className="text-right">Total Followers</span>
                </div>
              </div>
              <div className="divide-y">
                {pagedCurators.map((curator, index) => {
                  const absoluteRank = (curatorsPage - 1) * COMMUNITY_PAGE_SIZE + index + 1;
                  return (
                  <Link
                    key={curator.address}
                    to={`/agents/${encodeURIComponent(curator.address)}`}
                    className="group grid grid-cols-[72px_minmax(0,1.6fr)_140px_160px] gap-4 px-6 py-4 items-center transition-colors hover:bg-muted/20"
                  >
                    <span className="text-center font-semibold text-muted-foreground">
                      {absoluteRank}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold transition-colors group-hover:text-primary">
                        {getLeaderboardDisplayName(
                          currentUserActorId !== null && curator.address.toLowerCase() === currentUserActorId,
                          curator.address,
                          resolveAgentName,
                        )}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {currentUserActorId !== null && curator.address.toLowerCase() === currentUserActorId
                          ? 'Connected wallet'
                          : truncateAddress(curator.address)}
                      </div>
                    </div>
                    <span className="text-right flex items-center justify-end gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="tabular-nums">{curator.basketCount}</span>
                    </span>
                    <span className="text-right flex items-center justify-end gap-1.5">
                      <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="tabular-nums font-semibold">{curator.totalFollowers}</span>
                    </span>
                  </Link>
                  );
                })}
              </div>
              {filteredCommunityCurators.length > 0 ? (
                <div className="flex flex-col gap-3 border-t border-primary/10 px-6 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="text-sm text-muted-foreground">
                    Page {curatorsPage} of {curatorsTotalPages}
                  </div>
                  {curatorsTotalPages > 1 ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCuratorsPage((currentPage) => Math.max(1, currentPage - 1))}
                        disabled={curatorsPage === 1}
                      >
                        <ChevronLeft className="mr-1 h-4 w-4" />
                        Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCuratorsPage((currentPage) => Math.min(curatorsTotalPages, currentPage + 1))}
                        disabled={curatorsPage === curatorsTotalPages}
                      >
                        Next
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="winnings">
        {allTimeWinnersQuery.isLoading ? (
          <Card className="card-elevated">
            <CardContent className="p-0">
              <div className="border-b px-6 py-3">
                <Skeleton className="h-4 w-40" />
              </div>
              <div className="divide-y">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={`winnings-skeleton-${index}`}
                    className="grid grid-cols-4 gap-4 px-6 py-4 items-center"
                  >
                    <Skeleton className="h-4 w-6" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-20 ml-auto" />
                    <Skeleton className="h-4 w-28 ml-auto" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : filteredCommunityWinnings.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Coins className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                No all-time trading PnL yet. Settled history will appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="card-elevated">
            <CardContent className="p-0">
              <div className="border-b">
                <div className="grid grid-cols-[72px_minmax(0,1.6fr)_160px] gap-4 px-6 py-3 text-xs font-medium text-muted-foreground bg-muted/50">
                  <span className="text-center">#</span>
                  <span>Agent</span>
                  <span className="text-right">All-Time PnL</span>
                </div>
              </div>
              <div className="divide-y">
                {pagedWinnings.map((entry) => (
                  <Link
                    key={entry.user}
                    to={`/agents/${encodeURIComponent(entry.user)}`}
                    className="group grid grid-cols-[72px_minmax(0,1.6fr)_160px] gap-4 px-6 py-4 items-center transition-colors hover:bg-muted/20"
                  >
                    <span className="text-center font-semibold text-muted-foreground">
                      {entry.rank}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold transition-colors group-hover:text-primary">
                        {getLeaderboardDisplayName(
                          currentUserActorId !== null && entry.user.toLowerCase() === currentUserActorId,
                          entry.user,
                          resolveAgentName,
                        )}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {currentUserActorId !== null && entry.user.toLowerCase() === currentUserActorId
                          ? 'Connected wallet'
                          : truncateAddress(entry.user)}
                      </div>
                    </div>
                    <span className="text-right font-semibold tabular-nums">
                      {formatCompactChipAmount(entry.totalRealizedProfit)}
                    </span>
                  </Link>
                ))}
              </div>
              {filteredCommunityWinnings.length > 0 ? (
                <div className="flex flex-col gap-3 border-t border-primary/10 px-6 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="text-sm text-muted-foreground">
                    Page {winningsPage} of {winningsTotalPages}
                  </div>
                  {winningsTotalPages > 1 ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWinningsPage((currentPage) => Math.max(1, currentPage - 1))}
                        disabled={winningsPage === 1}
                      >
                        <ChevronLeft className="mr-1 h-4 w-4" />
                        Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWinningsPage((currentPage) => Math.min(winningsTotalPages, currentPage + 1))}
                        disabled={winningsPage === winningsTotalPages}
                      >
                        Next
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </TabsContent>
      </Tabs>
    </div>
  );
}

function CommunityLeaderboardTab() {
  const { network } = useNetwork();
  if (network !== 'vara') {
    return (
      <Card className="card-elevated">
        <CardContent className="py-12 text-center">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg font-medium">Community leaderboard is available on Vara only</p>
          <p className="text-sm text-muted-foreground mt-2">
            The Daily Contest tab remains available without wallet connection.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <CommunityVaraLeaderboard />;
}

export default function LeaderboardPage() {
  return (
    <div className="content-grid py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold mb-2">Leaderboard</h1>
        <p className="text-muted-foreground">
          Daily CHIP activity leaders for the current UTC day, plus the community leaderboard.
        </p>
      </div>

      <Tabs defaultValue="today" className="space-y-6">
        <TabsList>
        <TabsTrigger value="today" className="gap-2">
          <Timer className="w-4 h-4" />
          Today
        </TabsTrigger>
          <TabsTrigger value="community" className="gap-2">
            <Users className="w-4 h-4" />
            Community
          </TabsTrigger>
        </TabsList>

        <TabsContent value="today">
          <TodayContestTab />
        </TabsContent>

        <TabsContent value="community">
          <CommunityLeaderboardTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
