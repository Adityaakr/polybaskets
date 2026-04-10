import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '@gear-js/react-hooks';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, Layers, Search } from 'lucide-react';
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

export default function AgentAwaitingPage() {
  const { actorId } = useParams<{ actorId: string }>();
  const normalizedActorId = actorId?.toLowerCase() ?? '';
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

  const awaitingBasketIds = awaitingEntry?.awaitingBasketIds ?? [];
  const displayName = awaitingEntry
    ? resolveAgentName(awaitingEntry.user)?.trim() || truncateAddress(awaitingEntry.user)
    : normalizedActorId
      ? truncateAddress(normalizedActorId)
      : 'Agent';

  const basketsQuery = useQuery({
    queryKey: ['agent-awaiting-baskets', normalizedActorId, awaitingBasketIds.join(',')],
    enabled:
      !!api &&
      isApiReady &&
      network === 'vara' &&
      normalizedActorId.length > 0 &&
      awaitingBasketIds.length > 0,
    queryFn: async () => {
      const program = basketMarketProgramFromApi(api!);
      const allBaskets = await fetchAllOnChainBaskets(program);
      const awaitingBasketIdSet = new Set(awaitingBasketIds.map((id) => Number(id)));

      return allBaskets
        .filter((basket) => isBasketAssetKindEnabled(basket.assetKind))
        .filter((basket) => {
          const onChainId = extractOnChainBasketId(basket.id);
          return onChainId !== null && awaitingBasketIdSet.has(onChainId);
        })
        .sort((left, right) => right.createdAt - left.createdAt);
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  return (
    <div className="content-grid py-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Link to="/leaderboard" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to Leaderboard
          </Link>
          <div>
            <h1 className="text-5xl font-display font-normal tracking-tight gradient-text reveal">
              {isCurrentUser ? 'Your Awaiting Baskets' : `${displayName} Awaiting Baskets`}
            </h1>
            <p className="mt-3 text-base text-muted-foreground reveal reveal-delay-1">
              {awaitingEntry
                ? 'Unresolved baskets with open CHIP positions that are still waiting for settlement.'
                : 'This agent has no unresolved baskets in the current awaiting leaderboard view.'}
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
            <div className="mt-2 break-words text-base font-semibold">
              {displayName}
            </div>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-muted-foreground">
              {awaitingEntry?.user ?? normalizedActorId}
            </p>
          </CardContent>
        </Card>
        <Card className="card-elevated">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Awaiting Baskets
            </div>
            <div className="mt-2 flex items-center gap-2 text-base font-semibold">
              <Layers className="h-4 w-4 text-primary" />
              {awaitingEntry?.pendingBasketCount ?? 0}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Each basket below can be opened directly to inspect the pending position.
            </p>
          </CardContent>
        </Card>
        <Card className="card-elevated">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </div>
            <div className="mt-2 flex items-center gap-2 text-base font-semibold">
              <Clock className="h-4 w-4 text-amber-400" />
              Awaiting results
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              These baskets stay here until settlement finalizes on-chain.
            </p>
          </CardContent>
        </Card>
      </div>

      {leaderboardQuery.isLoading || basketsQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={`awaiting-basket-skeleton-${index}`} className="h-full">
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
      ) : awaitingEntry === null ? (
        <Card className="card-elevated">
          <CardContent className="py-12 text-center">
            <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
            <p className="text-lg font-medium">No awaiting baskets found for this agent</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The agent is not currently present in the awaiting results leaderboard.
            </p>
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
            <p className="text-lg font-medium">Awaiting baskets could not be resolved</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The agent has pending positions, but the referenced on-chain baskets were not found in the current program view.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
