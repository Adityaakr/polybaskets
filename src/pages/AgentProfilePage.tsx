import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '@gear-js/react-hooks';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Coins,
  Layers,
  Trophy,
} from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useAgentNames } from '@/hooks/useAgentNames';
import { useTodayContestLeaderboard } from '@/hooks/useTodayContestLeaderboard';
import { BasketCard } from '@/components/BasketCard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAllOnChainBaskets, extractOnChainBasketId } from '@/lib/basket-onchain';
import {
  fetchAgentActivityStreak,
  fetchAgentHistoricalBasketIds,
  fetchAgentProfileSummary,
  formatActivityIndex,
  formatChipAmount,
  formatUtcDateTime,
  formatUtcTime,
  formatVaraAmount,
} from '@/lib/contestLeaderboard';
import {
  betTokenProgramFromApi,
  fromTokenUnits,
  isBetProgramsConfigured,
  readSailsQuery,
  toBigIntValue,
} from '@/lib/betPrograms';
import { basketMarketProgramFromApi, actorIdFromAddress, fromVara } from '@/lib/varaClient';
import { truncateAddress } from '@/lib/basket-utils';
import { isBasketAssetKindEnabled } from '@/env';

type BasketCollection = Awaited<ReturnType<typeof fetchAllOnChainBaskets>>;

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  description: string;
  icon: typeof Activity;
}) {
  return (
    <Card className="card-elevated">
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <div className="mt-2 flex items-center gap-2 text-base font-semibold">
          <Icon className="h-4 w-4 text-primary" />
          <span>{value}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function BasketSection({
  title,
  description,
  baskets,
  href,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  description: string;
  baskets: BasketCollection;
  href: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-display tracking-tight">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" asChild>
          <Link to={href}>View all</Link>
        </Button>
      </div>

      {baskets.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {baskets.map((basket) => (
            <BasketCard key={`${title}-${basket.id}`} basket={basket} />
          ))}
        </div>
      ) : (
        <Card className="card-elevated">
          <CardContent className="py-10 text-center">
            <p className="text-base font-medium">{emptyTitle}</p>
            <p className="mt-2 text-sm text-muted-foreground">{emptyDescription}</p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

export default function AgentProfilePage() {
  const { actorId } = useParams<{ actorId: string }>();
  const normalizedActorId = actorId?.toLowerCase() ?? '';
  const { api, isApiReady } = useApi();
  const { network } = useNetwork();
  const { address } = useWallet();
  const { agents, resolveAgentName } = useAgentNames();
  const leaderboardQuery = useTodayContestLeaderboard();
  const isVaraEth = network === 'varaeth';
  const isConfigured = isBetProgramsConfigured();

  const currentUserActorId = useMemo(
    () => (address ? actorIdFromAddress(address).toLowerCase() : null),
    [address],
  );
  const isCurrentUser = currentUserActorId !== null && currentUserActorId === normalizedActorId;

  const agentRecord = useMemo(
    () => agents.find((agent) => agent.address.toLowerCase() === normalizedActorId) ?? null,
    [agents, normalizedActorId],
  );

  const scoredEntry = useMemo(
    () =>
      leaderboardQuery.data?.entries.find(
        (entry) => entry.user.toLowerCase() === normalizedActorId,
      ) ?? null,
    [leaderboardQuery.data?.entries, normalizedActorId],
  );

  const awaitingEntry = useMemo(
    () =>
      leaderboardQuery.data?.awaitingEntries.find(
        (entry) => entry.user.toLowerCase() === normalizedActorId,
      ) ?? null,
    [leaderboardQuery.data?.awaitingEntries, normalizedActorId],
  );

  const displayName = resolveAgentName(normalizedActorId)?.trim() ||
    agentRecord?.name?.trim() ||
    (normalizedActorId ? truncateAddress(normalizedActorId) : 'Agent');

  const betTokenProgram = useMemo(() => {
    if (!api || !isApiReady || isVaraEth || !isConfigured) {
      return null;
    }

    try {
      return betTokenProgramFromApi(api);
    } catch {
      return null;
    }
  }, [api, isApiReady, isConfigured, isVaraEth]);

  const tokenMetaQuery = useQuery({
    queryKey: ['agent-profile-token-meta', betTokenProgram?.programId],
    enabled: !!betTokenProgram,
    queryFn: async () => {
      const [symbol, decimals] = await Promise.all([
        readSailsQuery(betTokenProgram!.betToken.symbol()),
        readSailsQuery(betTokenProgram!.betToken.decimals()),
      ]);

      return {
        symbol,
        decimals: Number(decimals),
      };
    },
    staleTime: 60_000,
  });

  const chipBalanceQuery = useQuery({
    queryKey: ['agent-profile-chip-balance', normalizedActorId, betTokenProgram?.programId],
    enabled: !!betTokenProgram && normalizedActorId.length > 0,
    queryFn: async () => readSailsQuery(betTokenProgram!.betToken.balanceOf(normalizedActorId as `0x${string}`)),
    refetchInterval: 15_000,
  });

  const varaBalanceQuery = useQuery({
    queryKey: ['agent-profile-vara-balance', normalizedActorId, network],
    enabled: !!api && isApiReady && !isVaraEth && normalizedActorId.length > 0,
    queryFn: async () => {
      const balance = await api!.balance.findOut(normalizedActorId);
      return balance.toString();
    },
    refetchInterval: 15_000,
  });

  const profileSummaryQuery = useQuery({
    queryKey: ['agent-profile-summary', normalizedActorId],
    enabled: normalizedActorId.length > 0,
    queryFn: () => fetchAgentProfileSummary(normalizedActorId),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const currentStreakQuery = useQuery({
    queryKey: ['agent-profile-current-streak', normalizedActorId],
    enabled: normalizedActorId.length > 0,
    queryFn: () => fetchAgentActivityStreak(normalizedActorId),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const historicalBasketIdsQuery = useQuery({
    queryKey: ['agent-profile-historical-basket-ids', normalizedActorId],
    enabled: normalizedActorId.length > 0,
    queryFn: () => fetchAgentHistoricalBasketIds(normalizedActorId),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const basketCollectionsQuery = useQuery({
    queryKey: [
      'agent-profile-baskets',
      normalizedActorId,
      scoredEntry?.resolvedBasketIds.join(',') ?? '',
      awaitingEntry?.awaitingBasketIds.join(',') ?? '',
      historicalBasketIdsQuery.data?.join(',') ?? '',
    ],
    enabled: !!api && isApiReady && network === 'vara' && normalizedActorId.length > 0,
    queryFn: async () => {
      const program = basketMarketProgramFromApi(api!);
      const allBaskets = await fetchAllOnChainBaskets(program);
      const visibleBaskets = allBaskets.filter((basket) => isBasketAssetKindEnabled(basket.assetKind));
      const awaitingBasketIdSet = new Set((awaitingEntry?.awaitingBasketIds ?? []).map((id) => Number(id)));
      const todayBasketIdSet = new Set((scoredEntry?.resolvedBasketIds ?? []).map((id) => Number(id)));
      const historicalBasketIdSet = new Set((historicalBasketIdsQuery.data ?? []).map((id) => Number(id)));

      const byRecent = (left: BasketCollection[number], right: BasketCollection[number]) =>
        right.createdAt - left.createdAt;

      const createdBaskets = visibleBaskets
        .filter((basket) => basket.owner.toLowerCase() === normalizedActorId)
        .sort(byRecent);

      const awaitingBaskets = visibleBaskets
        .filter((basket) => {
          const onChainId = extractOnChainBasketId(basket.id);
          return onChainId !== null && awaitingBasketIdSet.has(onChainId);
        })
        .sort(byRecent);

      const todayBaskets = visibleBaskets
        .filter((basket) => {
          const onChainId = extractOnChainBasketId(basket.id);
          return onChainId !== null && todayBasketIdSet.has(onChainId);
        })
        .sort(byRecent);

      const historicalBaskets = visibleBaskets
        .filter((basket) => {
          const onChainId = extractOnChainBasketId(basket.id);
          return onChainId !== null && historicalBasketIdSet.has(onChainId);
        })
        .sort(byRecent);

      return {
        createdBaskets,
        awaitingBaskets,
        todayBaskets,
        historicalBaskets,
      };
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const tokenSymbol = tokenMetaQuery.data?.symbol ?? 'CHIP';
  const tokenDecimals = tokenMetaQuery.data?.decimals ?? 12;
  const chipBalance = `${fromTokenUnits(toBigIntValue(chipBalanceQuery.data), tokenDecimals)} ${tokenSymbol}`;
  const varaBalance = varaBalanceQuery.data
    ? `${fromVara(BigInt(varaBalanceQuery.data))} VARA`
    : 'Unavailable';

  const todayIndex = scoredEntry ? formatActivityIndex(scoredEntry) : '0.00';
  const todayRank = scoredEntry?.rank ?? null;
  const recentAwaitingBaskets = basketCollectionsQuery.data?.awaitingBaskets.slice(0, 3) ?? [];
  const recentTodayBaskets = basketCollectionsQuery.data?.todayBaskets.slice(0, 3) ?? [];
  const recentHistoricalBaskets = basketCollectionsQuery.data?.historicalBaskets.slice(0, 3) ?? [];
  const recentCreatedBaskets = basketCollectionsQuery.data?.createdBaskets.slice(0, 3) ?? [];

  const isLoading =
    leaderboardQuery.isLoading ||
    profileSummaryQuery.isLoading ||
    historicalBasketIdsQuery.isLoading ||
    basketCollectionsQuery.isLoading;

  const summaryError =
    (profileSummaryQuery.error as Error | undefined)?.message ||
    (historicalBasketIdsQuery.error as Error | undefined)?.message ||
    (basketCollectionsQuery.error as Error | undefined)?.message ||
    null;

  return (
    <div className="content-grid py-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Link
            to="/leaderboard"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Leaderboard
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-5xl font-display font-normal tracking-tight gradient-text reveal">
                {isCurrentUser ? 'Your Agent Profile' : displayName}
              </h1>
              {isCurrentUser ? <Badge>You</Badge> : null}
              {scoredEntry?.isCurrentWinner ? <Badge variant="secondary">Today&apos;s leader</Badge> : null}
            </div>
            <p className="mt-3 max-w-3xl text-base text-muted-foreground reveal reveal-delay-1">
              Detailed activity, balances, basket history, and contest context for this agent address.
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="outline" asChild>
            <Link to={`/agents/${encodeURIComponent(normalizedActorId)}/baskets/total`}>Finalized History</Link>
          </Button>
          <Button asChild>
            <Link to={`/agents/${encodeURIComponent(normalizedActorId)}/baskets/awaiting`}>Awaiting Baskets</Link>
          </Button>
        </div>
      </div>

      {isVaraEth && (
        <Alert className="mb-6">
          <AlertDescription>
            Agent profile queries are currently available on Vara Network only.
          </AlertDescription>
        </Alert>
      )}

      {summaryError ? (
        <Alert className="mb-6" variant="destructive">
          <AlertDescription>{summaryError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="card-elevated lg:col-span-1">
          <CardHeader className="pb-3">
            <CardDescription>Agent identity</CardDescription>
            <CardTitle className="text-2xl">{displayName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Address
              </div>
              <p className="mt-2 break-all font-mono text-xs leading-5 text-muted-foreground">
                {normalizedActorId}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  CHIP balance
                </div>
                <div className="mt-2 text-base font-semibold">
                  {chipBalanceQuery.isLoading ? 'Loading...' : chipBalance}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  VARA balance
                </div>
                <div className="mt-2 text-base font-semibold">
                  {varaBalanceQuery.isLoading ? 'Loading...' : varaBalance}
                </div>
              </div>
            </div>
            {agentRecord?.registered_at ? (
              <p className="text-xs text-muted-foreground">
                Registered on-chain. Last visible agent registry record: {agentRecord.registered_at}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="card-elevated lg:col-span-2">
          <CardHeader className="pb-3">
            <CardDescription>Today&apos;s activity snapshot</CardDescription>
            <CardTitle className="text-2xl">
              {scoredEntry ? `Index ${todayIndex}` : 'No scored activity yet'}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Rank
              </div>
              <div className="mt-2 text-base font-semibold">
                {todayRank ? `#${todayRank}` : 'Unranked'}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Transactions
              </div>
              <div className="mt-2 text-base font-semibold">
                {scoredEntry?.txCount ?? 0}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                P&amp;L today
              </div>
              <div className="mt-2 text-base font-semibold">
                {formatChipAmount(scoredEntry?.realizedProfit ?? '0')}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Last activity
              </div>
              <div className="mt-2 text-base font-semibold">
                {scoredEntry?.lastTxAt ? `${formatUtcTime(scoredEntry.lastTxAt)} UTC` : 'Pending'}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={`agent-profile-skeleton-${index}`} className="card-elevated">
                <CardContent className="space-y-3 p-4">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={`agent-profile-basket-skeleton-${index}`} className="card-elevated">
                <CardContent className="space-y-4 p-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-40 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Awaiting baskets"
              value={awaitingEntry?.pendingBasketCount ?? recentAwaitingBaskets.length}
              description="Open CHIP positions still waiting for settlement."
              icon={Clock}
            />
            <MetricCard
              title="Finalized baskets"
              value={profileSummaryQuery.data?.finalizedBasketCount ?? 0}
              description="Historical settled baskets that contributed to realized results."
              icon={CheckCircle2}
            />
            <MetricCard
              title="Created baskets"
              value={basketCollectionsQuery.data?.createdBaskets.length ?? 0}
              description="Visible on-chain baskets created by this address in the current program."
              icon={Layers}
            />
            <MetricCard
              title="Current streak"
              value={`${currentStreakQuery.data ?? 0}d`}
              description="Consecutive active UTC days ending today."
              icon={Activity}
            />
          </div>

          <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="All-time realized P&L"
              value={formatChipAmount(profileSummaryQuery.data?.totalRealizedProfit ?? '0')}
              description="Net realized CHIP result across all indexed finalized baskets."
              icon={Coins}
            />
            <MetricCard
              title="Rewards won"
              value={formatVaraAmount(profileSummaryQuery.data?.totalRewards ?? '0')}
              description="Contest rewards this agent has received from settled winning days."
              icon={Trophy}
            />
            <MetricCard
              title="Winning days"
              value={profileSummaryQuery.data?.winningDays ?? 0}
              description="Number of UTC contest days this address finished as the sole winner."
              icon={Trophy}
            />
            <MetricCard
              title="Best daily tx"
              value={profileSummaryQuery.data?.bestDailyTxCount ?? 0}
              description="Highest number of qualifying on-chain transactions recorded in a single UTC day."
              icon={Activity}
            />
          </div>

          <Card className="card-elevated mb-8">
            <CardHeader className="pb-3">
              <CardDescription>Quick links</CardDescription>
              <CardTitle className="text-2xl">Explore this agent</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Button variant="outline" asChild>
                <Link to={`/agents/${encodeURIComponent(normalizedActorId)}/baskets/today`}>
                  Today activity baskets
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/agents/${encodeURIComponent(normalizedActorId)}/baskets/awaiting`}>
                  Awaiting baskets
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/agents/${encodeURIComponent(normalizedActorId)}/baskets/total`}>
                  Finalized history
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/agents/${encodeURIComponent(normalizedActorId)}/baskets/created`}>
                  Created baskets
                </Link>
              </Button>
            </CardContent>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              {profileSummaryQuery.data?.lastIndexedActivityAt
                ? `Last indexed activity: ${formatUtcDateTime(profileSummaryQuery.data.lastIndexedActivityAt)} UTC`
                : 'No indexed activity has been recorded for this address yet.'}
            </CardContent>
          </Card>

          <div className="space-y-10">
            <BasketSection
              title="Awaiting Baskets"
              description="Open baskets where the address still has unresolved CHIP exposure."
              baskets={recentAwaitingBaskets}
              href={`/agents/${encodeURIComponent(normalizedActorId)}/baskets/awaiting`}
              emptyTitle="No awaiting baskets right now"
              emptyDescription="This address is not currently present in the awaiting leaderboard."
            />

            <BasketSection
              title="Today Activity Baskets"
              description="Resolved baskets contributing to the current UTC day activity leaderboard entry."
              baskets={recentTodayBaskets}
              href={`/agents/${encodeURIComponent(normalizedActorId)}/baskets/today`}
              emptyTitle="No scored baskets for today yet"
              emptyDescription="Once the agent has resolved basket contributions today, they will show up here."
            />

            <BasketSection
              title="Finalized History"
              description="Most recent settled baskets associated with this address in indexed history."
              baskets={recentHistoricalBaskets}
              href={`/agents/${encodeURIComponent(normalizedActorId)}/baskets/total`}
              emptyTitle="No finalized basket history yet"
              emptyDescription="This address does not have settled basket history available in the indexer."
            />

            <BasketSection
              title="Created Baskets"
              description="Recently visible baskets curated directly by this address."
              baskets={recentCreatedBaskets}
              href={`/agents/${encodeURIComponent(normalizedActorId)}/baskets/created`}
              emptyTitle="No created baskets found"
              emptyDescription="This address does not currently appear as a basket creator in the on-chain program."
            />
          </div>
        </>
      )}
    </div>
  );
}
