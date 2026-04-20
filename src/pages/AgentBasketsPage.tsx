import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '@gear-js/react-hooks';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock, Layers, Search } from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useAgentNames } from '@/hooks/useAgentNames';
import { useTodayContestLeaderboard } from '@/hooks/useTodayContestLeaderboard';
import { BasketCard } from '@/components/BasketCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAllOnChainBaskets, extractOnChainBasketId } from '@/lib/basket-onchain';
import { basketMarketProgramFromApi, actorIdFromAddress } from '@/lib/varaClient';
import { truncateAddress } from '@/lib/basket-utils';
import { isBasketAssetKindEnabled } from '@/env';
import { fetchAgentHistoricalBasketIds } from '@/lib/contestLeaderboard';

type AgentBasketView = 'today' | 'awaiting' | 'total' | 'created';

const isAgentBasketView = (value: string | undefined): value is AgentBasketView =>
  value === 'today' || value === 'awaiting' || value === 'total' || value === 'created';

export default function AgentBasketsPage() {
  const { actorId, view } = useParams<{ actorId: string; view: string }>();
  const normalizedActorId = actorId?.toLowerCase() ?? '';
  const currentView: AgentBasketView = isAgentBasketView(view) ? view : 'total';
  const { api, isApiReady } = useApi();
  const { network } = useNetwork();
  const { address } = useWallet();
  const { resolveAgentName } = useAgentNames();
  const leaderboardQuery = useTodayContestLeaderboard();

  const currentUserActorId = useMemo(
    () => (address ? actorIdFromAddress(address).toLowerCase() : null),
    [address],
  );
  const isCurrentUser = currentUserActorId !== null && currentUserActorId === normalizedActorId;

  const awaitingEntry = useMemo(
    () =>
      leaderboardQuery.data?.awaitingEntries.find(
        (entry) => entry.user.toLowerCase() === normalizedActorId,
      ) ?? null,
    [leaderboardQuery.data?.awaitingEntries, normalizedActorId],
  );

  const scoredEntry = useMemo(
    () =>
      leaderboardQuery.data?.entries.find(
        (entry) => entry.user.toLowerCase() === normalizedActorId,
      ) ?? null,
    [leaderboardQuery.data?.entries, normalizedActorId],
  );

  const historicalBasketIdsQuery = useQuery({
    queryKey: ['agent-historical-basket-ids', normalizedActorId],
    enabled: currentView === 'total' && normalizedActorId.length > 0,
    queryFn: () => fetchAgentHistoricalBasketIds(normalizedActorId),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const selectedBasketIds = useMemo(() => {
    switch (currentView) {
      case 'awaiting':
        return awaitingEntry?.awaitingBasketIds ?? [];
      case 'today':
        return scoredEntry?.resolvedBasketIds ?? [];
      case 'total':
        return historicalBasketIdsQuery.data ?? [];
      case 'created':
        return [];
    }
  }, [
    awaitingEntry?.awaitingBasketIds,
    currentView,
    historicalBasketIdsQuery.data,
    scoredEntry?.resolvedBasketIds,
  ]);

  const displaySourceEntry = awaitingEntry ?? scoredEntry;
  const displayName = displaySourceEntry
    ? resolveAgentName(displaySourceEntry.user)?.trim() || truncateAddress(displaySourceEntry.user)
    : normalizedActorId
      ? resolveAgentName(normalizedActorId)?.trim() || truncateAddress(normalizedActorId)
      : 'Agent';

  const basketsQuery = useQuery({
    queryKey: ['agent-baskets', normalizedActorId, currentView, selectedBasketIds.join(',')],
    enabled:
      !!api &&
      isApiReady &&
      network === 'vara' &&
      normalizedActorId.length > 0 &&
      (currentView === 'created' || selectedBasketIds.length > 0),
    queryFn: async () => {
      const program = basketMarketProgramFromApi(api!);
      const allBaskets = await fetchAllOnChainBaskets(program);

      if (currentView === 'created') {
        return allBaskets
          .filter((basket) => isBasketAssetKindEnabled(basket.assetKind))
          .filter((basket) => basket.owner.toLowerCase() === normalizedActorId)
          .sort((left, right) => right.createdAt - left.createdAt);
      }

      const basketIdSet = new Set(selectedBasketIds.map((id) => Number(id)));

      return allBaskets
        .filter((basket) => isBasketAssetKindEnabled(basket.assetKind))
        .filter((basket) => {
          const onChainId = extractOnChainBasketId(basket.id);
          return onChainId !== null && basketIdSet.has(onChainId);
        })
        .sort((left, right) => right.createdAt - left.createdAt);
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const pageMeta = useMemo(() => {
    switch (currentView) {
      case 'awaiting':
        return {
          title: isCurrentUser ? 'Your Awaiting Baskets' : `${displayName} Awaiting Baskets`,
          description:
            'Unresolved baskets with open CHIP positions that are still waiting for settlement.',
          countLabel: 'Pending Positions',
          countValue: awaitingEntry?.pendingBasketCount ?? selectedBasketIds.length,
          statusLabel: 'Awaiting results',
          statusIcon: Clock,
          emptyTitle: 'No awaiting baskets found for this agent',
          emptyDescription:
            'The agent is not currently present in the awaiting results leaderboard.',
        };
      case 'today':
        return {
          title: isCurrentUser ? 'Your Today Activity' : `${displayName} Today Activity`,
          description:
            'Resolved baskets that contributed to this agent’s current 12:00 UTC contest-window activity leaderboard entry.',
          countLabel: 'Finalized Baskets',
          countValue: scoredEntry?.basketCount ?? selectedBasketIds.length,
          statusLabel: 'Activity-scored today',
          statusIcon: CheckCircle2,
          emptyTitle: 'No activity-scored baskets found for this agent today',
          emptyDescription:
            'The agent does not currently have resolved basket contributions in today’s activity leaderboard.',
        };
      case 'created':
        return {
          title: isCurrentUser ? 'Your Created Baskets' : `${displayName} Created Baskets`,
          description:
            'All on-chain baskets created by this curator in the current program.',
          countLabel: 'Created Baskets',
          countValue: basketsQuery.data?.length ?? 0,
          statusLabel: 'Curator view',
          statusIcon: Layers,
          emptyTitle: 'No created baskets found for this curator',
          emptyDescription:
            'This address does not have visible on-chain baskets in the current program.',
        };
      case 'total':
      default:
        return {
          title: isCurrentUser ? 'Your Finalized Baskets' : `${displayName} Finalized Baskets`,
          description:
            'Historical baskets that already finalized and contributed to this agent’s all-time results.',
          countLabel: 'Finalized Baskets',
          countValue: selectedBasketIds.length,
          statusLabel: 'All-time history',
          statusIcon: CheckCircle2,
          emptyTitle: 'No historical finalized baskets found for this agent',
          emptyDescription:
            'The agent has no settled basket history available in the indexer yet.',
        };
    }
  }, [
    awaitingEntry?.pendingBasketCount,
    basketsQuery.data?.length,
    currentView,
    displayName,
    isCurrentUser,
    scoredEntry?.basketCount,
    selectedBasketIds.length,
  ]);

  const StatusIcon = pageMeta.statusIcon;
  const isLoading =
    leaderboardQuery.isLoading ||
    basketsQuery.isLoading ||
    (currentView === 'total' && historicalBasketIdsQuery.isLoading);

  const isError =
    basketsQuery.isError || (currentView === 'total' && historicalBasketIdsQuery.isError);
  const errorMessage =
    (basketsQuery.error as Error | undefined)?.message ||
    (historicalBasketIdsQuery.error as Error | undefined)?.message ||
    'Unknown indexer error';

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
            <h1 className="text-3xl md:text-5xl font-display font-normal tracking-tight gradient-text reveal">
              {pageMeta.title}
            </h1>
            <p className="mt-3 text-base text-muted-foreground reveal reveal-delay-1">
              {pageMeta.description}
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="outline" asChild>
            <Link to="/leaderboard">Leaderboard</Link>
          </Button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="card-elevated">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Agent
            </div>
            <div className="mt-2 break-words text-base font-semibold">{displayName}</div>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-muted-foreground">
              {displaySourceEntry?.user ?? normalizedActorId}
            </p>
          </CardContent>
        </Card>
        <Card className="card-elevated">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {pageMeta.countLabel}
            </div>
            <div className="mt-2 flex items-center gap-2 text-base font-semibold">
              <Layers className="h-4 w-4 text-primary" />
              {pageMeta.countValue}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Each basket below can be opened directly for the full basket page.
            </p>
          </CardContent>
        </Card>
        <Card className="card-elevated">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </div>
            <div className="mt-2 flex items-center gap-2 text-base font-semibold">
              <StatusIcon className="h-4 w-4 text-emerald-400" />
              {pageMeta.statusLabel}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              This page is a public, read-only view of the agent’s relevant baskets.
            </p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={`agent-basket-skeleton-${index}`} className="h-full">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-12" />
                </div>
                <Skeleton className="h-7 w-40" />
                <Skeleton className="h-4 w-48" />
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <Card className="card-elevated">
          <CardContent className="py-12 text-center">
            <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
            <p className="text-lg font-medium">Unable to load this agent view</p>
            <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
          </CardContent>
        </Card>
      ) : basketsQuery.data && basketsQuery.data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {basketsQuery.data.map((basket) => (
            <BasketCard key={basket.id} basket={basket} />
          ))}
        </div>
      ) : (
        <Card className="card-elevated">
          <CardContent className="py-12 text-center">
            <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
            <p className="text-lg font-medium">{pageMeta.emptyTitle}</p>
            <p className="mt-2 text-sm text-muted-foreground">{pageMeta.emptyDescription}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
