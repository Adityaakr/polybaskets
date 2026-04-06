import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { searchMarkets, fetchCuratedLatest, fetchMarketsByCategory, POLYMARKET_CATEGORIES, type MarketCategory } from '@/lib/polymarket.ts';
import { MarketCard } from './MarketCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import type { PolymarketMarket } from '@/types/polymarket.ts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils.ts';

export function MarketSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<MarketCategory>('all');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const queryFn = useCallback(async () => {
    // If there's a search query, use search (ignores category)
    if (debouncedQuery && debouncedQuery.trim().length > 0) {
      console.log('[MarketSearch] Searching for:', debouncedQuery);
      try {
        const result = await searchMarkets(debouncedQuery.trim());
        console.log('[MarketSearch] Search results:', result.markets.length, 'markets found');
        return result.markets;
      } catch (error) {
        console.error('[MarketSearch] Search error:', error);
        return [];
      }
    }
    
    // No search query - fetch by category or curated latest
    if (selectedCategory === 'all') {
      console.log('[MarketSearch] Fetching all markets (curated latest)');
      try {
        const markets = await fetchCuratedLatest();
        console.log('[MarketSearch] All markets results:', markets.length, 'markets found');
        return markets;
      } catch (error) {
        console.error('[MarketSearch] Error fetching all markets:', error);
        return [];
      }
    }
    
    // Fetch by category
    console.log('[MarketSearch] Fetching category:', selectedCategory);
    try {
      const markets = await fetchMarketsByCategory(selectedCategory, 50);
      console.log('[MarketSearch] Category results:', markets.length, 'markets found for', selectedCategory);
      
      // If no results, log warning
      if (markets.length === 0) {
        console.warn(`[MarketSearch] No markets found for category: ${selectedCategory}. Check browser console for API details.`);
      }
      
      return markets;
    } catch (error) {
      console.error('[MarketSearch] Category fetch error:', error);
      return [];
    }
  }, [debouncedQuery, selectedCategory]);

  // Check if search is active (must be defined before useQuery)
  const isSearchActive = debouncedQuery && debouncedQuery.trim().length > 0;

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ['markets', debouncedQuery || selectedCategory, selectedCategory],
    queryFn,
    staleTime: 0, // Always fetch fresh data for live updates - never use stale data
    // Continuously refetch to catch new markets
    // When searching, only refetch on manual refresh or window focus
    // When browsing categories, refetch every 2 seconds to catch new markets
    refetchInterval: isSearchActive ? false : 2000, // Refetch every 2 seconds to catch new markets
    refetchIntervalInBackground: !isSearchActive, // Continue refetching in background to catch new markets
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchOnMount: true, // Always refetch on mount to get latest markets
    retry: 3, // Retry failed requests
    retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 3000), // Faster exponential backoff
  }) as { data?: PolymarketMarket[]; isLoading: boolean; isFetching: boolean; isError: boolean; error: unknown };

  // Reset category when user starts typing and clear it when search is active
  useEffect(() => {
    if (query.trim().length > 0) {
      setSelectedCategory('all');
    }
  }, [query]);

  return (
    <div className="space-y-6">
      {/* Category Filter Tabs */}
      {!debouncedQuery && (
        <div className="flex flex-wrap gap-2">
          {POLYMARKET_CATEGORIES.map((category) => {
            const isEndingSoon = category.id === 'ending-soon';
            return (
              <Button
                key={category.id}
                variant={selectedCategory === category.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  'transition-all duration-200',
                  selectedCategory === category.id
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'hover:bg-secondary',
                  isEndingSoon && selectedCategory === category.id && 'ring-2 ring-orange-500 ring-offset-2',
                  isEndingSoon && selectedCategory !== category.id && 'border-orange-500/50'
                )}
              >
                {category.label}
                {isEndingSoon && (
                  <span className="ml-1.5 text-xs opacity-75">⚡</span>
                )}
              </Button>
            );
          })}
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search any Polymarket... (e.g., Trump, Bitcoin, Super Bowl, Elections)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 h-12 text-base"
        />
        {isFetching && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Auto-refresh indicator - hidden for cleaner UX, data still refreshes in background */}

      {/* Results */}
      {isError ? (
        <div className="text-center py-12">
          <div className="text-destructive mb-2">
            Failed to load markets{error instanceof Error ? `: ${error.message}` : ''}
          </div>
          <div className="text-sm text-muted-foreground">
            Please check your browser console for more details. The Polymarket API might be temporarily unavailable.
          </div>
        </div>
      ) : isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="overflow-hidden border-border/50">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-2 w-2 rounded-full" />
                </div>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-16 rounded-md" />
                  <Skeleton className="h-16 rounded-md" />
                </div>
                <Skeleton className="h-1.5 w-full rounded-full" />
                <div className="flex gap-4">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-5 w-20 ml-auto rounded-full" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-8 rounded-md" />
                  <Skeleton className="h-8 rounded-md" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((market, index) => (
            <MarketCard key={`${market.id}-${index}`} market={market} index={index} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          {debouncedQuery
            ? `No markets found for "${debouncedQuery}"`
            : selectedCategory === 'ending-soon'
            ? 'No markets ending within the next hour. Check back soon!'
            : selectedCategory !== 'all'
            ? `No markets found in ${POLYMARKET_CATEGORIES.find(c => c.id === selectedCategory)?.label || selectedCategory}`
            : 'Search for prediction markets to add to your basket'}
        </div>
      )}
    </div>
  );
}
