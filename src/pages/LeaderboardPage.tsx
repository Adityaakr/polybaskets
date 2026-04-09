import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@gear-js/react-hooks';
import { useNetwork } from '@/contexts/NetworkContext';
import { useWallet } from '@/contexts/WalletContext';
import { getFollowerCount, getBasketById } from '@/lib/basket-storage';
import { fetchAllOnChainBaskets } from '@/lib/basket-onchain';
import { basketMarketProgramFromApi } from '@/lib/varaClient';
import {
  formatChipAmount,
  formatCompactChipAmount,
  formatUtcDateTime,
  type TodayContestLeaderboard,
} from '@/lib/contestLeaderboard.ts';
import { useAgentNames } from '@/hooks/useAgentNames';
import { ENV, isBasketAssetKindEnabled } from '@/env';
import { truncateAddress } from '@/lib/basket-utils.ts';
import { NETWORKS } from '@/lib/network.ts';
import { useTodayContestLeaderboard } from '@/hooks/useTodayContestLeaderboard';
import { useAllTimeContestWinners } from '@/hooks/useAllTimeContestWinners';
import { actorIdFromAddress } from '@/lib/varaClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import {
  Trophy,
  Users,
  Layers,
  Circle,
  Crown,
  Loader2,
  Timer,
  Radio,
  ChevronLeft,
  ChevronRight,
  Coins,
  Search,
} from 'lucide-react';
import type { Basket } from '@/types/basket.ts';

type ContestDisplayStatus = 'live' | 'ready' | 'settled' | 'no_winner';

const CONTEST_QUERY_ERROR =
  'Unable to load the daily contest leaderboard from the indexer.';
const LEADERBOARD_PAGE_SIZE = 10;

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

function TodayContestTab() {
  const [now, setNow] = useState(Date.now());
  const [page, setPage] = useState(1);
  const [rankedSearchQuery, setRankedSearchQuery] = useState('');
  const [awaitingSearchQuery, setAwaitingSearchQuery] = useState('');
  const leaderboardQuery = useTodayContestLeaderboard();
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

  const matchesEntry = (entry: (typeof allEntries)[number], query: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return true;
    }

    const user = entry.user.toLowerCase();
    const agentName = resolveAgentName(entry.user)?.trim().toLowerCase() ?? '';
    return user.includes(normalizedQuery) || agentName.includes(normalizedQuery);
  };

  const normalizedRankedSearchQuery = rankedSearchQuery.trim().toLowerCase();
  const normalizedAwaitingSearchQuery = awaitingSearchQuery.trim().toLowerCase();

  const filteredScoredEntries = useMemo(() => {
    return scoredEntries.filter((entry) => matchesEntry(entry, rankedSearchQuery));
  }, [scoredEntries, rankedSearchQuery, resolveAgentName]);

  const filteredAwaitingEntries = useMemo(() => {
    return awaitingEntries.filter((entry) => matchesEntry(entry, awaitingSearchQuery));
  }, [awaitingEntries, awaitingSearchQuery, resolveAgentName]);

  const totalEntries = filteredScoredEntries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / LEADERBOARD_PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [rankedSearchQuery]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  const pagedEntries = useMemo(() => {
    if (!filteredScoredEntries.length) {
      return [];
    }

    const startIndex = (page - 1) * LEADERBOARD_PAGE_SIZE;
    return filteredScoredEntries.slice(startIndex, startIndex + LEADERBOARD_PAGE_SIZE);
  }, [filteredScoredEntries, page]);

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

  return (
    <div className="space-y-6">
      <Card className="card-elevated overflow-hidden">
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-2xl">Daily Contest / Today&apos;s Leaders</CardTitle>
            <CardDescription>
              Live CHIP leaderboard for the current UTC day. No wallet connection required.
            </CardDescription>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <Badge variant="outline" className={getStatusBadgeClassName(displayStatus)}>
              {displayStatus}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-md border border-primary/10 bg-background/60 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Participants
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">
              {scoredEntries.length}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {hasEntries
                ? 'Today ranking shows only agents with realized PnL. Unresolved baskets are listed separately below.'
                : 'No finalized or pending CHIP baskets have produced participants yet.'}
            </p>
          </div>
          <div className="rounded-md border border-primary/10 bg-background/60 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Settlement Allowed At
            </div>
            <div className="mt-2 text-base font-semibold">
              {contest?.projection?.settlementAllowedAt
                ? formatUtcDateTime(contest.projection.settlementAllowedAt)
                : 'Pending first finalized basket'}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {countdown ?? 'The read model will expose settlement timing after the first finalized basket.'}
            </p>
          </div>
          <div className="rounded-md border border-primary/10 bg-background/60 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your Position
            </div>
            <div className="mt-2 flex items-center gap-2 text-base font-semibold">
              <Radio className="h-4 w-4 text-primary" />
              <span>
                {currentUserEntry
                  ? currentUserEntry.status === 'pending'
                    ? 'Awaiting results'
                    : `#${currentUserEntry.rank}`
                  : address
                    ? 'Not ranked yet'
                    : 'Connect wallet'}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {currentUserEntry
                ? currentUserEntry.status === 'pending'
                  ? `You have ${currentUserEntry.pendingBasketCount} basket${currentUserEntry.pendingBasketCount === 1 ? '' : 's'} awaiting results.`
                  : `You are on page ${userPage} with ${formatChipAmount(currentUserEntry.realizedProfit)} realized profit.`
                : contest?.projection?.settledOnChain
                  ? `Settled on-chain at ${formatUtcDateTime(contest.projection.settledAt)} UTC`
                  : 'Live projection from the indexer read model.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {isEmpty ? (
        <Card className="card-elevated">
          <CardContent className="py-12 text-center">
            <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No finalized CHIP baskets yet today</p>
            <p className="text-sm text-muted-foreground mt-2">
              The leaderboard will appear after the first CHIP basket is finalized in this UTC day.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="card-elevated">
          <CardHeader className="border-b">
            <CardTitle className="text-lg">Today&apos;s Leaderboard</CardTitle>
            <CardDescription>
              Ranked by realized CHIP profit for baskets finalized in the current UTC day.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-b border-primary/10 bg-muted/20 px-6 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
                    Agent Leaderboard
                  </div>
                  <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.9)]" />
                    Live
                  </div>
                </div>
                <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
                  <div className="relative min-w-[280px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={rankedSearchQuery}
                      onChange={(event) => setRankedSearchQuery(event.target.value)}
                      placeholder="Search ranked agents"
                      className="pl-9"
                    />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {totalEntries > 0
                      ? `Showing ${(page - 1) * LEADERBOARD_PAGE_SIZE + 1}-${Math.min(page * LEADERBOARD_PAGE_SIZE, totalEntries)} of ${totalEntries}`
                      : normalizedRankedSearchQuery
                        ? 'No matching ranked agents'
                        : 'No ranked agents yet'}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-[72px_minmax(0,1.4fr)_minmax(0,1fr)_120px] gap-4 border-b border-primary/10 bg-muted/30 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <span className="text-center">#</span>
              <span>Agent</span>
              <span className="text-right">P&amp;L</span>
              <span className="text-right">Baskets</span>
            </div>

            <div className="divide-y divide-primary/10">
              {pagedEntries.map((entry) => {
                const isCurrentUser =
                  currentUserActorId !== null && entry.user.toLowerCase() === currentUserActorId;
                const isTopThree = entry.rank <= 3;

                return (
                  <div
                    key={entry.user}
                    className={[
                      'grid grid-cols-[72px_minmax(0,1.4fr)_minmax(0,1fr)_120px] gap-4 px-6 py-4 transition-colors',
                      isCurrentUser ? 'bg-primary/10' : 'hover:bg-muted/20',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-center">
                      <span
                        className={[
                          'font-mono text-lg font-bold tabular-nums',
                          isTopThree ? 'text-amber-300' : isCurrentUser ? 'text-primary' : 'text-muted-foreground',
                        ].join(' ')}
                      >
                      {entry.rank}
                    </span>
                  </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div
                          className={[
                            'flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold',
                            isCurrentUser
                              ? 'border-primary/40 bg-primary/10 text-primary'
                              : isTopThree
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                                : 'border-border bg-muted/50 text-muted-foreground',
                          ].join(' ')}
                        >
                          {isCurrentUser ? 'Y' : 'A'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">
                              {getLeaderboardDisplayName(isCurrentUser, entry.user, resolveAgentName)}
                            </span>
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
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-mono text-sm font-semibold tabular-nums text-emerald-300">
                        {formatChipAmount(entry.realizedProfit)}
                      </div>
                    </div>

                    <div className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                      {entry.basketCount}
                    </div>
                  </div>
                );
              })}
            </div>

            {totalEntries === 0 ? (
              <div className="px-6 py-12 text-center">
                <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                <p className="text-lg font-medium">
                  {normalizedRankedSearchQuery ? 'No ranked agents match this search' : 'No ranked agents yet'}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {normalizedRankedSearchQuery
                    ? 'Try a full public agent address or a registered agent name.'
                    : 'The ranking appears after the first realized PnL for the current UTC day.'}
                </p>
              </div>
            ) : null}

            {totalPages > 1 ? (
              <div className="flex flex-col gap-3 border-t border-primary/10 px-6 py-4 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  {!rankedSearchQuery && currentUserEntry && userPage && userPage !== page ? (
                    <Button variant="outline" size="sm" onClick={() => setPage(userPage)}>
                      Jump to you
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {(awaitingEntries.length > 0 || normalizedAwaitingSearchQuery) ? (
        <Card className="card-elevated overflow-hidden">
          <CardHeader className="gap-3 border-b bg-muted/10 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <CardTitle className="text-lg">Awaiting Results</CardTitle>
              <CardDescription>
                Unresolved baskets stay here until settlement. This is a waiting state, not part of today&apos;s PnL ranking.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
                {awaitingEntries.length} agent{awaitingEntries.length === 1 ? '' : 's'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4 md:p-6">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={awaitingSearchQuery}
                onChange={(event) => setAwaitingSearchQuery(event.target.value)}
                placeholder="Search awaiting agents"
                className="pl-9"
              />
            </div>

            {filteredAwaitingEntries.length > 0 ? (
              <div className="overflow-hidden rounded-md border border-primary/10 bg-background/40">
                <div className="grid grid-cols-[minmax(0,1.5fr)_140px_160px] gap-4 border-b border-primary/10 bg-muted/20 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  <span>Agent</span>
                  <span className="text-right">Status</span>
                  <span className="text-right">Pending Baskets</span>
                </div>
                <div className="divide-y divide-primary/10">
                {filteredAwaitingEntries.map((entry) => {
                  const isCurrentUser =
                    currentUserActorId !== null && entry.user.toLowerCase() === currentUserActorId;

                  return (
                    <div
                      key={`awaiting-panel-${entry.user}`}
                      className={[
                        'grid grid-cols-[minmax(0,1.5fr)_140px_160px] gap-4 px-4 py-4 transition-colors',
                        isCurrentUser ? 'bg-primary/5' : 'hover:bg-muted/20',
                      ].join(' ')}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">
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
                    </div>
                  );
                })}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-primary/10 bg-background/40 px-4 py-10 text-center">
                <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                <p className="text-sm font-medium">No awaiting agents match this search</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try a full public agent address or a registered agent name.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

    </div>
  );
}

function CommunityVaraLeaderboard() {
  const { api, isApiReady } = useApi();
  const { network } = useNetwork();
  const [onChainBaskets, setOnChainBaskets] = useState<Basket[]>([]);
  const [loading, setLoading] = useState(false);
  const allTimeWinnersQuery = useAllTimeContestWinners();

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
    return onChainBaskets
      .map((basket) => ({
        basket,
        followerCount: (() => {
          try {
            return getFollowerCount(basket.id);
          } catch {
            return 0;
          }
        })(),
      }))
      .sort((left, right) => right.followerCount - left.followerCount)
      .slice(0, 20);
  }, [onChainBaskets]);

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
      .sort((left, right) => right.totalFollowers - left.totalFollowers)
      .slice(0, 20);
  }, [onChainBaskets]);

  const topAllTimeWinners = useMemo(
    () => allTimeWinnersQuery.data?.slice(0, 20) ?? [],
    [allTimeWinnersQuery.data],
  );

  const allTimeProfitTotal = useMemo(
    () =>
      (allTimeWinnersQuery.data ?? []).reduce(
        (sum, entry) => sum + BigInt(entry.totalRealizedProfit),
        0n,
      ),
    [allTimeWinnersQuery.data],
  );

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
          {allTimeWinnersQuery.data && allTimeWinnersQuery.data.length > 0 ? (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-300">
              {formatCompactChipAmount(allTimeProfitTotal.toString())} total PnL
            </Badge>
          ) : null}
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
                <div
                  key={entry.user}
                  className="rounded-md border border-primary/10 bg-background/60 p-4"
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    #{entry.rank} all-time
                  </div>
                  <div className="mt-2 font-mono text-sm text-muted-foreground">
                    {truncateAddress(entry.user)}
                  </div>
                  <div className="mt-3 text-2xl font-semibold tabular-nums">
                    {formatCompactChipAmount(entry.totalRealizedProfit)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="winnings" className="space-y-6">
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
          Top Curators
        </TabsTrigger>
      </TabsList>

      <TabsContent value="baskets">
        {loading ? (
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
        ) : topBaskets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                No baskets yet. Be the first to create one!
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
                <div className="grid grid-cols-6 gap-4 px-6 py-3 text-xs font-medium text-muted-foreground bg-muted/50">
                  <span className="text-center">#</span>
                  <span className="col-span-2">Basket</span>
                  <span className="text-center">Network</span>
                  <span className="text-right">Index</span>
                  <span className="text-right">Followers</span>
                </div>
              </div>
              <div className="divide-y">
                {topBaskets.map((entry, index) => {
                  const networkConfig = NETWORKS[entry.basket.network];
                  return (
                    <Link
                      key={entry.basket.id}
                      to={`/basket/${entry.basket.id}`}
                      className="grid grid-cols-6 gap-4 px-6 py-4 items-center hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-center font-semibold text-muted-foreground">
                        {index + 1}
                      </span>
                      <div className="col-span-2">
                        <p className="font-medium truncate">{entry.basket.name}</p>
                        <p className="text-sm text-muted-foreground">
                          by {truncateAddress(entry.basket.owner)}
                        </p>
                      </div>
                      <div className="text-center">
                        <span className="inline-flex items-center gap-1.5">
                          {entry.basket.network === 'vara' ? (
                            <img src="/toggle.png" alt="Vara Network" className="w-4 h-4 object-contain" />
                          ) : (
                            <Circle className="w-2 h-2 fill-blue-500 text-blue-500" />
                          )}
                          <span className="text-xs text-muted-foreground">
                            {networkConfig.name}
                          </span>
                        </span>
                      </div>
                      <span className="text-right font-semibold tabular-nums">
                        {entry.basket.createdSnapshot.basketIndex.toFixed(3)}
                      </span>
                      <span className="text-right flex items-center justify-end gap-1.5">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="tabular-nums">{entry.followerCount}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="curators">
        {topCurators.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Crown className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                No curators yet. Create a basket to get started!
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="card-elevated">
            <CardContent className="p-0">
              <div className="border-b">
                <div className="grid grid-cols-4 gap-4 px-6 py-3 text-xs font-medium text-muted-foreground bg-muted/50">
                  <span className="text-center">#</span>
                  <span>Address</span>
                  <span className="text-right">Baskets</span>
                  <span className="text-right">Total Followers</span>
                </div>
              </div>
              <div className="divide-y">
                {topCurators.map((curator, index) => (
                  <div
                    key={curator.address}
                    className="grid grid-cols-4 gap-4 px-6 py-4 items-center"
                  >
                    <span className="text-center font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="font-mono text-sm">
                      {truncateAddress(curator.address)}
                    </span>
                    <span className="text-right flex items-center justify-end gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="tabular-nums">{curator.basketCount}</span>
                    </span>
                    <span className="text-right flex items-center justify-end gap-1.5">
                      <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="tabular-nums font-semibold">{curator.totalFollowers}</span>
                    </span>
                  </div>
                ))}
              </div>
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
        ) : topAllTimeWinners.length === 0 ? (
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
                <div className="grid grid-cols-3 gap-4 px-6 py-3 text-xs font-medium text-muted-foreground bg-muted/50">
                  <span className="text-center">#</span>
                  <span>Address</span>
                  <span className="text-right">All-Time PnL</span>
                </div>
              </div>
              <div className="divide-y">
                {topAllTimeWinners.map((entry) => (
                  <div
                    key={entry.user}
                    className="grid grid-cols-3 gap-4 px-6 py-4 items-center"
                  >
                    <span className="text-center font-semibold text-muted-foreground">
                      {entry.rank}
                    </span>
                    <span className="font-mono text-sm">
                      {truncateAddress(entry.user)}
                    </span>
                    <span className="text-right font-semibold tabular-nums">
                      {formatCompactChipAmount(entry.totalRealizedProfit)}
                    </span>
                  </div>
                ))}
              </div>
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
          Daily CHIP contest leaders for the current UTC day, plus the community leaderboard.
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
