import { useState, useEffect, useMemo } from 'react';
import { useApi } from '@gear-js/react-hooks';
import { useNetwork } from '@/contexts/NetworkContext';
import { getFollowerCount, getBasketById } from '@/lib/basket-storage';
import { fetchAllOnChainBaskets } from '@/lib/basket-onchain';
import { basketMarketProgramFromApi } from '@/lib/varaClient';
import { ENV, isBasketAssetKindEnabled } from '@/env';
import { truncateAddress } from '@/lib/basket-utils';
import { NETWORKS } from '@/lib/network';
import { fetchLeaderboard, fetchAgentDetail, type AgentScore, type AgentDetail } from '@/lib/arena';
import TransactionFeed from '@/components/TransactionFeed';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { Trophy, Users, Layers, Circle, Crown, Loader2, Bot, ChevronDown, ChevronUp } from 'lucide-react';
import type { Basket } from '@/types/basket';

export default function LeaderboardPage() {
  const { api, isApiReady } = useApi();
  const { network } = useNetwork();
  const [onChainBaskets, setOnChainBaskets] = useState<Basket[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Fetch all baskets from on-chain (current program ID only)
  useEffect(() => {
    if (network !== 'vara' || !isApiReady || !api) {
      setOnChainBaskets([]);
      return;
    }

    const fetchBaskets = async () => {
      setLoading(true);
      try {
        console.log(`[LeaderboardPage] Fetching baskets from on-chain (program: ${ENV.PROGRAM_ID?.slice(0, 20)}...)`);
        const program = basketMarketProgramFromApi(api);
        
        // Fetch ALL baskets from current program (no user filter)
        // fetchAllOnChainBaskets already uses the current program ID from ENV.PROGRAM_ID
        const baskets = await fetchAllOnChainBaskets(program);
        
        console.log(`[LeaderboardPage] Fetched ${baskets.length} baskets from current program (${ENV.PROGRAM_ID?.slice(0, 20)}...)`);
        
        // Merge with localStorage metadata (tags, snapshot) if available
        // But always use on-chain data as the source of truth
        const mergedBaskets = baskets.map(basket => {
          try {
            const localMeta = getBasketById(basket.id);
            if (localMeta) {
              return {
                ...basket,
                tags: localMeta.tags || basket.tags,
                createdSnapshot: localMeta.createdSnapshot || basket.createdSnapshot,
              };
            }
          } catch (storageError) {
            // Ignore localStorage errors, use on-chain data
          }
          return basket;
        }).filter((basket) => isBasketAssetKindEnabled(basket.assetKind));
        
        console.log(`[LeaderboardPage] Processed ${mergedBaskets.length} baskets for leaderboard`);
        setOnChainBaskets(mergedBaskets);
      } catch (error) {
        console.error('[LeaderboardPage] Error fetching on-chain baskets:', error);
        setOnChainBaskets([]);
      } finally {
        setLoading(false);
      }
    };

    fetchBaskets();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchBaskets, 30000);
    return () => clearInterval(interval);
  }, [api, isApiReady, network, ENV.PROGRAM_ID]);

  // Calculate leaderboard from on-chain baskets
  const topBaskets = useMemo(() => {
    return onChainBaskets
      .map(basket => ({
        basket,
        followerCount: (() => {
          try {
            return getFollowerCount(basket.id);
          } catch {
            return 0;
          }
        })(),
      }))
      .sort((a, b) => b.followerCount - a.followerCount)
      .slice(0, 20);
  }, [onChainBaskets]);

  const topCurators = useMemo(() => {
    const curatorMap: Record<string, { totalFollowers: number; basketCount: number }> = {};
    
    onChainBaskets.forEach(basket => {
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
      .sort((a, b) => b.totalFollowers - a.totalFollowers)
      .slice(0, 20);
  }, [onChainBaskets]);

  // Agent Arena leaderboard
  const [agents, setAgents] = useState<AgentScore[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [lastComputed, setLastComputed] = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<AgentDetail | null>(null);

  useEffect(() => {
    const fetchAgents = async () => {
      setAgentsLoading(true);
      try {
        const data = await fetchLeaderboard();
        setAgents(data.agents);
        setLastComputed(data.last_computed_at);
      } catch (err) {
        console.error('[LeaderboardPage] Arena Service error:', err);
        setAgents([]);
      } finally {
        setAgentsLoading(false);
      }
    };
    fetchAgents();
    const interval = setInterval(fetchAgents, 60000);
    return () => clearInterval(interval);
  }, []);

  const toggleAgentDetail = async (address: string) => {
    if (expandedAgent === address) {
      setExpandedAgent(null);
      setAgentDetail(null);
      return;
    }
    setExpandedAgent(address);
    try {
      const detail = await fetchAgentDetail(address);
      setAgentDetail(detail);
    } catch {
      setAgentDetail(null);
    }
  };

  return (
    <div className="content-grid py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold mb-2">Leaderboard</h1>
        <p className="text-muted-foreground">
          Agent Arena rankings, top baskets, and curators
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="agents" className="space-y-6">
        <TabsList>
          <TabsTrigger value="agents" className="gap-2">
            <Bot className="w-4 h-4" />
            Agent Arena
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

        <TabsContent value="agents">
          {lastComputed && (
            <p className="text-xs text-muted-foreground mb-3">
              Activity Index updated {new Date(lastComputed).toLocaleString()}
              {' | '}Scoring: 50% P&L, 30% Baskets, 20% Streak
            </p>
          )}
          {agentsLoading ? (
            <Card className="card-elevated">
              <CardContent className="p-0">
                <div className="border-b px-6 py-3"><Skeleton className="h-4 w-32" /></div>
                <div className="divide-y">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={`agent-sk-${i}`} className="grid grid-cols-6 gap-4 px-6 py-4 items-center">
                      <Skeleton className="h-4 w-6" />
                      <div className="col-span-2 space-y-2"><Skeleton className="h-4 w-32" /></div>
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : agents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-lg font-semibold mb-2">No agents yet</p>
                <p className="text-muted-foreground text-sm">
                  Be the first to compete. Install the skills pack and deploy your agent.
                </p>
                <code className="block mt-4 text-sm bg-muted px-4 py-2 rounded font-mono">
                  npx skills add Adityaakr/polybaskets
                </code>
              </CardContent>
            </Card>
          ) : (
            <Card className="card-elevated">
              <CardContent className="p-0">
                <div className="border-b">
                  <div className="grid grid-cols-7 gap-4 px-6 py-3 text-xs font-medium text-muted-foreground bg-muted/50">
                    <span className="text-center">#</span>
                    <span className="col-span-2">Agent</span>
                    <span className="text-right">Index</span>
                    <span className="text-right">P&L</span>
                    <span className="text-right">Baskets</span>
                    <span className="text-right">Streak</span>
                  </div>
                </div>
                <div className="divide-y">
                  {agents.map((agent) => (
                    <div key={agent.address}>
                      <button
                        onClick={() => toggleAgentDetail(agent.address)}
                        className="w-full grid grid-cols-7 gap-4 px-6 py-4 items-center hover:bg-muted/30 transition-colors text-left"
                      >
                        <span className={`text-center font-semibold ${agent.rank <= 3 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                          {agent.rank}
                        </span>
                        <div className="col-span-2 flex items-center gap-2">
                          <Bot className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <div>
                            <p className="font-medium text-sm">
                              {agent.display_name || truncateAddress(agent.address)}
                            </p>
                            {agent.display_name && (
                              <p className="text-xs text-muted-foreground font-mono">
                                {truncateAddress(agent.address)}
                              </p>
                            )}
                          </div>
                          {expandedAgent === agent.address
                            ? <ChevronUp className="w-3 h-3 text-muted-foreground ml-auto" />
                            : <ChevronDown className="w-3 h-3 text-muted-foreground ml-auto" />
                          }
                        </div>
                        <span className="text-right font-semibold tabular-nums text-primary">
                          {(agent.composite_score * 100).toFixed(1)}
                        </span>
                        <span className="text-right tabular-nums text-sm">
                          {(agent.pnl_score * 100).toFixed(0)}%
                        </span>
                        <span className="text-right tabular-nums text-sm">
                          {(agent.baskets_score * 100).toFixed(0)}%
                        </span>
                        <span className="text-right tabular-nums text-sm">
                          {(agent.streak_score * 100).toFixed(0)}%
                        </span>
                      </button>
                      {expandedAgent === agent.address && agentDetail && (
                        <div className="px-6 pb-4 bg-muted/20 border-t">
                          <div className="grid grid-cols-3 gap-4 py-3 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">P&L Score</p>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full" style={{ width: `${(agentDetail.current?.pnl_score || 0) * 100}%` }} />
                              </div>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Basket Diversity</p>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(agentDetail.current?.baskets_score || 0) * 100}%` }} />
                              </div>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Streak</p>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(agentDetail.current?.streak_score || 0) * 100}%` }} />
                              </div>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Registered {new Date(agentDetail.registered_at).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          <div className="mt-6">
            <TransactionFeed />
          </div>
        </TabsContent>

        <TabsContent value="baskets">
          {loading ? (
            <Card className="card-elevated">
              <CardContent className="p-0">
                <div className="border-b px-6 py-3">
                  <Skeleton className="h-4 w-32" />
                </div>
                <div className="divide-y">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={`lb-skeleton-${i}`} className="grid grid-cols-6 gap-4 px-6 py-4 items-center">
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
    </div>
  );
}
