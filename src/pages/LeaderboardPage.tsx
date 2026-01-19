import { useState, useEffect, useMemo } from 'react';
import { useApi } from '@gear-js/react-hooks';
import { useNetwork } from '@/contexts/NetworkContext';
import { getFollowerCount, getBasketById } from '@/lib/basket-storage';
import { fetchAllOnChainBaskets } from '@/lib/basket-onchain';
import { basketMarketProgramFromApi } from '@/lib/varaClient';
import { ENV } from '@/env';
import { truncateAddress } from '@/lib/basket-utils';
import { NETWORKS } from '@/lib/network';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { Trophy, Users, Layers, Circle, Crown, Loader2 } from 'lucide-react';
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
        });
        
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

  return (
    <div className="content-grid py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold mb-2">Leaderboard</h1>
        <p className="text-muted-foreground">
          Most followed baskets and top curators
        </p>
      </div>

      {/* Tabs */}
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
            <Card>
              <CardContent className="py-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">
                  Loading baskets from blockchain...
                </p>
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
