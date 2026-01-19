import { useWallet } from '@/contexts/WalletContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useApi } from '@gear-js/react-hooks';
import { getBasketsByOwner, getFollows, getBasketById, deleteBasket, getBaskets } from '@/lib/basket-storage';
import { extractOnChainBasketId, fetchAllOnChainBaskets } from '@/lib/basket-onchain';
import { basketMarketProgramFromApi } from '@/lib/varaClient';
import { ENV } from '@/env';
import { BasketCard } from '@/components/BasketCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link, useNavigate } from 'react-router-dom';
import { Wallet, Plus, Heart, Layers, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { Basket } from '@/types/basket';

export default function MyBasketsPage() {
  const { address, connect, isConnecting } = useWallet();
  const { network } = useNetwork();
  const { api, isApiReady } = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingBasketId, setDeletingBasketId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [onChainBaskets, setOnChainBaskets] = useState<Basket[]>([]);
  const [loadingOnChain, setLoadingOnChain] = useState(false);

  // Combine on-chain baskets with localStorage baskets (for non-Vara networks or drafts)
  // MUST be called before any early returns to follow Rules of Hooks
  const { myBaskets, followedBaskets } = useMemo(() => {
    if (!address) {
      return { myBaskets: [], followedBaskets: [] };
    }
    
    // For Vara network, prioritize on-chain baskets (sustainable, permanent)
    // For other networks or if on-chain fetch failed, fall back to localStorage
    let baskets: Basket[] = [];
    
    try {
      if (network === 'vara' && onChainBaskets.length > 0) {
        // Use on-chain baskets (the source of truth)
        baskets = onChainBaskets;
        console.log(`[MyBasketsPage] Using ${baskets.length} on-chain baskets for Vara network`);
      } else {
        // Fallback to localStorage (for Vara.eth or if on-chain fetch failed)
        try {
          const localBaskets = getBasketsByOwner(address);
          // Filter out on-chain baskets from localStorage - they're from the old program ID
          // Only show localStorage baskets that are NOT on-chain (i.e., drafts or other networks)
          baskets = localBaskets.filter(b => {
            const isOnChain = b.id.startsWith('onchain-');
            if (isOnChain) {
              console.log(`[MyBasketsPage] Filtering out old on-chain basket from localStorage: ${b.id} (${b.name})`);
            }
            return !isOnChain; // Only keep non-on-chain baskets from localStorage
          });
          console.log(`[MyBasketsPage] Using ${baskets.length} localStorage baskets (network: ${network}, filtered out old on-chain baskets)`);
        } catch (storageError) {
          console.warn('[MyBasketsPage] localStorage access failed:', storageError);
          baskets = [];
        }
      }
      
      // Get followed baskets (from localStorage - follows are stored locally)
      let followedBaskets: Basket[] = [];
      try {
        const followedIds = getFollows(address);
        followedBaskets = followedIds
          .map(id => {
            try {
              return getBasketById(id);
            } catch (e) {
              console.warn(`[MyBasketsPage] Failed to get basket ${id}:`, e);
              return null;
            }
          })
          .filter((b): b is NonNullable<typeof b> => b !== null);
      } catch (storageError) {
        console.warn('[MyBasketsPage] Failed to get followed baskets:', storageError);
        followedBaskets = [];
      }
      
      return { myBaskets: baskets, followedBaskets };
    } catch (error) {
      console.error('[MyBasketsPage] Error in useMemo:', error);
      return { myBaskets: [], followedBaskets: [] };
    }
  }, [address, network, onChainBaskets, refreshKey]);

  // Fetch baskets from on-chain (sustainable, permanent storage)
  useEffect(() => {
    if (!address || !isApiReady || !api || network !== 'vara') {
      setOnChainBaskets([]);
      return;
    }

    const fetchBaskets = async () => {
      setLoadingOnChain(true);
      try {
        console.log(`[MyBasketsPage] Fetching baskets from on-chain for address: ${address}`);
        const program = basketMarketProgramFromApi(api);
        const baskets = await fetchAllOnChainBaskets(program, address);
        
        console.log(`[MyBasketsPage] Raw on-chain baskets:`, baskets.map(b => ({
          id: b.id,
          name: b.name,
          owner: b.owner,
          itemsCount: b.items.length
        })));
        
        // Verify each basket actually exists on the current program before showing it
        // This ensures we don't show baskets from the old program ID
        const verifiedBaskets: Basket[] = [];
        for (const basket of baskets) {
          try {
            // Try to fetch the basket from on-chain to verify it exists
            const onChainId = extractOnChainBasketId(basket.id);
            if (onChainId !== null) {
              // This is an on-chain basket - verify it exists on current program
              try {
                const verifyResult = await program.basketMarket.getBasket(onChainId).call();
                if ('err' in verifyResult) {
                  console.log(`[MyBasketsPage] Basket ${basket.id} (onchain-${onChainId}) does not exist on current program, filtering out`);
                  continue; // Skip this basket - it's from the old program
                }
                console.log(`[MyBasketsPage] ✓ Verified basket ${basket.id} exists on current program`);
              } catch (verifyError) {
                console.log(`[MyBasketsPage] Could not verify basket ${basket.id}, filtering out:`, verifyError);
                continue; // Skip if verification fails
              }
            }
            
            // Merge with localStorage metadata (tags, snapshot) if available
            try {
              const localMeta = getBasketById(basket.id);
              if (localMeta) {
                // Merge metadata from localStorage
                verifiedBaskets.push({
                  ...basket,
                  tags: localMeta.tags || basket.tags,
                  createdSnapshot: localMeta.createdSnapshot || basket.createdSnapshot,
                });
              } else {
                verifiedBaskets.push(basket);
              }
            } catch (storageError) {
              console.warn(`[MyBasketsPage] Failed to get localStorage metadata for basket ${basket.id}:`, storageError);
              verifiedBaskets.push(basket);
            }
          } catch (error) {
            console.error(`[MyBasketsPage] Error processing basket ${basket.id}:`, error);
            // Skip this basket if there's an error
          }
        }
        
        console.log(`[MyBasketsPage] Fetched ${verifiedBaskets.length} verified baskets from on-chain (current program ID: ${ENV.PROGRAM_ID?.slice(0, 10)}..., filtered out ${baskets.length - verifiedBaskets.length} invalid baskets)`);
        setOnChainBaskets(verifiedBaskets);
      } catch (error) {
        console.error('[MyBasketsPage] Error fetching on-chain baskets:', error);
        toast({
          title: 'Error Loading Baskets',
          description: 'Could not fetch baskets from blockchain. Please try refreshing.',
          variant: 'destructive',
        });
        setOnChainBaskets([]);
      } finally {
        setLoadingOnChain(false);
      }
    };

    fetchBaskets();
    
    // Refresh every 30 seconds to get new baskets
    const interval = setInterval(fetchBaskets, 30000);
    return () => clearInterval(interval);
  }, [address, isApiReady, api, network, refreshKey, toast]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Force re-fetch from on-chain
      setRefreshKey(prev => prev + 1);
      // Invalidate all market-details queries to force refresh
      await queryClient.invalidateQueries({ queryKey: ['market-details'] });
      // Refetch all active queries
      await queryClient.refetchQueries({ queryKey: ['market-details'] });
    } catch (error) {
      console.error('Error refreshing basket data:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDeleteBasket = (basketId: string, basketName: string) => {
    // Check if it's an on-chain basket
    const onChainId = extractOnChainBasketId(basketId);
    if (onChainId !== null) {
      toast({
        title: 'Cannot Delete On-Chain Basket',
        description: 'This basket exists on the blockchain and cannot be deleted from the frontend. It will remain on-chain permanently.',
        variant: 'destructive',
      });
      return;
    }

    if (window.confirm(`Are you sure you want to delete "${basketName}"?\n\nThis will only remove it from your local view. If it's on-chain, it will still exist on the blockchain.`)) {
      setDeletingBasketId(basketId);
      try {
        const deleted = deleteBasket(basketId);
        if (deleted) {
          toast({
            title: 'Basket Deleted',
            description: `"${basketName}" has been removed from your local view.`,
          });
          // Refresh the page to update the list
          window.location.reload();
        } else {
          toast({
            title: 'Delete Failed',
            description: 'Could not delete the basket.',
            variant: 'destructive',
          });
        }
      } catch (storageError) {
        console.error('[MyBasketsPage] Failed to delete basket:', storageError);
        toast({
          title: 'Delete Failed',
          description: 'Could not access storage to delete the basket.',
          variant: 'destructive',
        });
      } finally {
        setDeletingBasketId(null);
      }
    }
  };

  if (!address) {
    return (
      <div className="content-grid py-8">
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Wallet className="w-8 h-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">Connect Wallet</h1>
          <p className="text-muted-foreground mb-6">
            Connect your wallet to see your baskets and follows
          </p>
          <Button onClick={connect} disabled={isConnecting} size="lg">
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="content-grid py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-5xl font-display font-normal mb-3 tracking-tight gradient-text reveal">My Baskets</h1>
          <p className="text-muted-foreground text-base reveal reveal-delay-1">
            Manage your created baskets and follows
            <span className="ml-2 text-xs opacity-75">(Live updates)</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link to="/builder">
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Create Basket
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="created" className="space-y-6">
        <TabsList>
          <TabsTrigger value="created" className="gap-2">
            <Layers className="w-4 h-4" />
            Created ({myBaskets.length})
          </TabsTrigger>
          <TabsTrigger value="following" className="gap-2">
            <Heart className="w-4 h-4" />
            Following ({followedBaskets.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="created">
          {loadingOnChain && network === 'vara' ? (
            <Card>
              <CardContent className="py-12 text-center">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">
                  Loading baskets from blockchain...
                </p>
              </CardContent>
            </Card>
          ) : myBaskets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground mb-2">
                  You haven't created any baskets yet
                </p>
                <p className="text-sm text-muted-foreground/70 mb-4">
                  {network === 'vara' 
                    ? 'Baskets are stored permanently on the Vara blockchain'
                    : 'Create your first basket to get started'}
                </p>
                <Link to="/builder">
                  <Button variant="outline">Create Basket</Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {myBaskets.map((basket, index) => {
                // Ensure unique keys - use index as fallback if ID is somehow duplicate
                const uniqueKey = `${basket.id}-${index}`;
                return (
                  <BasketCard 
                    key={uniqueKey} 
                    basket={basket} 
                    onDelete={address && basket.owner.toLowerCase() === address.toLowerCase() ? () => handleDeleteBasket(basket.id, basket.name) : undefined}
                    isDeleting={deletingBasketId === basket.id}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="following">
          {followedBaskets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground mb-4">
                  You're not following any baskets yet
                </p>
                <Link to="/leaderboard">
                  <Button variant="outline">Browse Leaderboard</Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {followedBaskets.map(basket => (
                <BasketCard key={basket.id} basket={basket} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
