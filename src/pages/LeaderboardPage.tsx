import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@gear-js/react-hooks';
import { useNetwork } from '@/contexts/NetworkContext.tsx';
import { getFollowerCount, getBasketById } from '@/lib/basket-storage.ts';
import { fetchAllOnChainBaskets } from '@/lib/basket-onchain.ts';
import { basketMarketProgramFromApi } from '@/lib/varaClient.ts';
import {
  formatChipAmount,
  formatUtcDateTime,
  type TodayContestLeaderboard,
} from '@/lib/contestLeaderboard.ts';
import { ENV, isBasketAssetKindEnabled } from '@/env.ts';
import { truncateAddress } from '@/lib/basket-utils.ts';
import { NETWORKS } from '@/lib/network.ts';
import { useTodayContestLeaderboard } from '@/hooks/useTodayContestLeaderboard.ts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.tsx';
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
} from 'lucide-react';
import type { Basket } from '@/types/basket.ts';

type ContestDisplayStatus = 'live' | 'ready' | 'settled' | 'no_winner';

const CONTEST_QUERY_ERROR =
  'Unable to load the daily contest leaderboard from the indexer.';

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

function TodayContestTab() {
  const [now, setNow] = useState(Date.now());
  const leaderboardQuery = useTodayContestLeaderboard();
  const contest = leaderboardQuery.data;
  const displayStatus = getContestDisplayStatus(contest);
  const countdown = getCountdownLabel(contest?.projection?.settlementAllowedAt, now);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

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

  const hasEntries = (contest?.entries.length ?? 0) > 0;
  const isNoWinner = contest?.projection?.status === 'no_winner';
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
              {contest?.entries.length ?? 0}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {hasEntries
                ? 'All users with realized profit today are ranked in descending order.'
                : 'No finalized CHIP baskets have produced participants yet.'}
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
              Day Status
            </div>
            <div className="mt-2 flex items-center gap-2 text-base font-semibold">
              <Radio className="h-4 w-4 text-primary" />
              <span>{displayStatus}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {contest?.projection?.settledOnChain
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
      ) : isNoWinner ? (
        <Card className="card-elevated">
          <CardContent className="py-12 text-center">
            <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">No winner for this UTC day</p>
            <p className="text-sm text-muted-foreground mt-2">
              This contest day closed without any eligible positive leader rows.
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">Rank</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Realized Profit</TableHead>
                  <TableHead className="text-right">Baskets</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contest?.entries.map((entry) => (
                  <TableRow key={entry.user}>
                    <TableCell className="text-center font-semibold text-muted-foreground">
                      {entry.rank}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      <div className="flex items-center gap-2">
                        <span>{truncateAddress(entry.user)}</span>
                        {entry.isCurrentWinner ? (
                          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                            Leader
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatChipAmount(entry.realizedProfit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {entry.basketCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CommunityVaraLeaderboard() {
  const { api, isApiReady } = useApi();
  const { network } = useNetwork();
  const [onChainBaskets, setOnChainBaskets] = useState<Basket[]>([]);
  const [loading, setLoading] = useState(false);

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

  return (
    <Tabs defaultValue="baskets" className="space-y-6">
      <TabsList>
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
    </Tabs>
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
