import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { searchMarkets, fetchCuratedLatest, fetchMarketsByCategory, POLYMARKET_CATEGORIES, type MarketCategory } from '@/lib/polymarket';
import { MarketCard } from './MarketCard';
import { Skeleton } from '@/components/ui/skeleton';
import { useCallback } from 'react';
import type { PolymarketMarket } from '@/types/polymarket';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
          placeholder="Search markets... (e.g., Trump, Bitcoin, Fed)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 h-12 text-base"
        />
        {isFetching && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Auto-refresh indicator */}
      {!isSearchActive && isFetching && (
        <div className="text-xs text-muted-foreground text-center py-2">
          <Loader2 className="w-3 h-3 inline animate-spin mr-1" />
          Checking for new markets...
        </div>
      )}

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
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((market, index) => (
            <MarketCard key={`${market.id}-${index}`} market={market} />
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
