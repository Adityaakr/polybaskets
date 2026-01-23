import { PolymarketMarket, OutcomeProbabilities } from '@/types/polymarket';

// Live data only; remove mock fallback
const POLYMARKET_GAMMA_BASE = import.meta.env.VITE_GAMMA_PROXY || 'https://gamma-api.polymarket.com';
const gammaBase = POLYMARKET_GAMMA_BASE.includes('gamma-api') ? '/gamma' : POLYMARKET_GAMMA_BASE;

// Lightweight session cache to avoid repeated network hits (keeps UI responsive)
const MARKET_CACHE_TTL_MS = 30_000; // 30s
type CacheEntry<T> = { data: T; expiresAt: number };

function cacheGet<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function cacheSet<T>(key: string, data: T, ttlMs: number = MARKET_CACHE_TTL_MS): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };
    window.sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Ignore storage errors (quota, private mode, etc.)
  }
}

export interface MarketFilters {
  query?: string;
  category?: string;
  tagId?: number | null; // Polymarket tag_id for category filtering
  active?: boolean;
  closed?: boolean;
  minVolume?: number;
  minLiquidity?: number;
  startDateMin?: string; // ISO date string
  startDateMax?: string; // ISO date string
  endDateMin?: string; // ISO date string
  endDateMax?: string; // ISO date string
  limit?: number;
  offset?: number;
  orderBy?: 'volume' | 'liquidity' | 'endDate' | 'created';
  ascending?: boolean;
}

// Polymarket category definitions with tag_id values from their API
// Each category has a tag_id that maps to Polymarket's category system
export const POLYMARKET_CATEGORIES = [
  { 
    id: 'all', 
    label: 'All Markets', 
    tagId: null,
    query: '', 
    categoryValues: [],
    keywords: []
  },
  { 
    id: 'ending-soon', 
    label: 'Ending Soon (1hr)', 
    tagId: null,
    query: '', 
    categoryValues: [],
    keywords: [],
    isTimeBased: true // Special flag for time-based filtering
  },
  { 
    id: 'politics', 
    label: 'Politics', 
    tagId: 2, // Politics tag_id from Polymarket API
    query: 'politics', 
    categoryValues: ['politics', 'political', 'election', 'elections', 'government', 'president', 'senate', 'congress'],
    keywords: ['trump', 'biden', 'election', 'vote', 'president', 'senate', 'congress', 'democrat', 'republican', 'political']
  },
  { 
    id: 'crypto', 
    label: 'Crypto', 
    tagId: 21, // Crypto tag_id from Polymarket API
    query: 'crypto', 
    categoryValues: ['crypto', 'cryptocurrency', 'bitcoin', 'ethereum', 'blockchain'],
    keywords: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 'blockchain', 'defi', 'nft', 'xrp', 'solana', 'cardano']
  },
  { 
    id: 'tech', 
    label: 'Tech', 
    tagId: 1401, // Tech tag_id from Polymarket API
    query: 'tech', 
    categoryValues: ['tech', 'technology', 'ai', 'artificial intelligence'],
    keywords: ['tech', 'technology', 'ai', 'artificial intelligence', 'apple', 'google', 'microsoft', 'meta', 'tesla', 'nvidia', 'amd']
  },
  { 
    id: 'gaming', 
    label: 'Gaming', 
    tagId: null, // Gaming might not have a specific tag_id, use query fallback
    query: 'gaming', 
    categoryValues: ['gaming', 'games', 'esports', 'esport'],
    keywords: ['gaming', 'game', 'esports', 'esport', 'lol', 'league of legends', 'dota', 'csgo', 'valorant', 'fortnite']
  },
  { 
    id: 'sports', 
    label: 'Sports', 
    tagId: 100639, // Sports tag_id from Polymarket API
    query: 'sports', 
    categoryValues: ['sports', 'sport', 'football', 'basketball', 'soccer'],
    keywords: ['sports', 'sport', 'nfl', 'nba', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball', 'hockey', 'olympics']
  },
  { 
    id: 'finance', 
    label: 'Finance', 
    tagId: 120, // Finance tag_id from Polymarket API
    query: 'finance', 
    categoryValues: ['finance', 'financial', 'stocks', 'stock market'],
    keywords: ['finance', 'financial', 'stocks', 'stock market', 'sp500', 'dow', 'nasdaq', 'fed', 'interest rate', 'inflation']
  },
  { 
    id: 'entertainment', 
    label: 'Entertainment', 
    tagId: 596, // Culture/Entertainment tag_id from Polymarket API
    query: 'entertainment', 
    categoryValues: ['entertainment', 'movies', 'music', 'tv'],
    keywords: ['entertainment', 'movie', 'music', 'tv', 'television', 'oscar', 'grammy', 'super bowl', 'halftime']
  },
  { 
    id: 'health', 
    label: 'Health', 
    tagId: null, // Health might not have a specific tag_id, use query fallback
    query: 'health', 
    categoryValues: ['health', 'medical', 'medicine', 'healthcare', 'health care'],
    keywords: [
      'health', 'medical', 'medicine', 'covid', 'vaccine', 'fda', 'drug', 'treatment', 
      'hospital', 'doctor', 'disease', 'illness', 'pandemic', 'epidemic', 'pharmaceutical', 
      'pharma', 'patient', 'surgery', 'diagnosis', 'therapy', 'clinic', 'nurse', 
      'prescription', 'medication', 'cure', 'symptom', 'infection', 'virus', 'bacteria',
      'cancer', 'diabetes', 'heart', 'blood', 'organ', 'transplant', 'mental health',
      'psychology', 'psychiatry', 'wellness', 'fitness', 'nutrition', 'diet'
    ]
  },
  { 
    id: 'weather', 
    label: 'Weather', 
    tagId: null, // Weather might not have a specific tag_id, use query fallback
    query: 'weather climate temperature hurricane', 
    categoryValues: ['weather', 'climate', 'temperature'],
    keywords: ['weather', 'climate', 'temperature', 'hurricane', 'tornado', 'rain', 'snow', 'storm', 'flood', 'drought', 'heat', 'cold', 'fahrenheit', 'celsius', 'precipitation', 'forecast']
  },
  { 
    id: 'economics', 
    label: 'Economics', 
    tagId: null, // Economics might not have a specific tag_id, use query fallback
    query: 'economics gdp unemployment inflation', 
    categoryValues: ['economics', 'economic', 'economy'],
    keywords: ['economics', 'economic', 'economy', 'gdp', 'unemployment', 'recession', 'inflation', 'deflation', 'fed', 'federal reserve', 'interest rate', 'monetary', 'fiscal', 'growth', 'recession']
  },
] as const;

export type MarketCategory = typeof POLYMARKET_CATEGORIES[number]['id'];

/**
 * Format category name for display
 */
export function formatCategoryName(category: string | undefined): string {
  if (!category) return 'General';
  
  // Find matching category config
  const categoryConfig = POLYMARKET_CATEGORIES.find(c => {
    if (c.id === category.toLowerCase() || c.label.toLowerCase() === category.toLowerCase()) {
      return true;
    }
    if (c.categoryValues && Array.isArray(c.categoryValues)) {
      return c.categoryValues.some((v: string) => typeof v === 'string' && v.toLowerCase() === category.toLowerCase());
    }
    return false;
  });
  
  if (categoryConfig) {
    return categoryConfig.label;
  }
  
  // Capitalize first letter
  return category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
}

function mapMarket(m: any): PolymarketMarket | null {
  // Skip if no question or id (required fields)
  if (!m.question && !m.questionID && !m.id && !m.condition_id && !m.slug) {
    console.warn('[mapMarket] Skipping market with no identifier:', m);
    return null;
  }
  
  // Parse outcomes - can be JSON string or array
  let outcomes: string[] = ['Yes', 'No'];
  if (m.outcomes) {
    if (typeof m.outcomes === 'string') {
      try {
        outcomes = JSON.parse(m.outcomes);
      } catch {
        outcomes = ['Yes', 'No'];
      }
    } else if (Array.isArray(m.outcomes)) {
      outcomes = m.outcomes;
    }
  }

  // Parse outcomePrices - can be JSON string or array
  // Try multiple field names and formats
  let outcomePrices: string[] | undefined;
  
  // Try all possible field names for prices
  const pricesRaw = m.outcomePrices || m.outcome_prices || m.prices || m.price || m.outcomePrice 
    || m.tokenPrices || m.token_prices || m.poolPrices || m.pool_prices;
  
  if (pricesRaw) {
    if (typeof pricesRaw === 'string') {
      try {
        outcomePrices = JSON.parse(pricesRaw);
      } catch {
        // If parsing fails, try splitting by comma
        try {
          outcomePrices = pricesRaw.split(',').map((p: string) => p.trim());
        } catch {
          outcomePrices = undefined;
        }
      }
    } else if (Array.isArray(pricesRaw)) {
      outcomePrices = pricesRaw.map((p: any) => String(p));
    } else if (typeof pricesRaw === 'object' && pricesRaw !== null) {
      // Handle object format like {yes: 0.5, no: 0.5}
      if ('yes' in pricesRaw || 'YES' in pricesRaw || 'Yes' in pricesRaw) {
        const yesPrice = pricesRaw.yes || pricesRaw.YES || pricesRaw.Yes || '0.5';
        const noPrice = pricesRaw.no || pricesRaw.NO || pricesRaw.No || '0.5';
        outcomePrices = [String(yesPrice), String(noPrice)];
      }
    }
  }
  
  // Try extracting from tokens array (common in Polymarket API)
  if (!outcomePrices && Array.isArray(m.tokens) && m.tokens.length >= 2) {
    outcomePrices = m.tokens.map((token: any) => {
      // Try various price fields in token object
      const price = token.price || token.lastPrice || token.currentPrice || token.tokenPrice || '0.5';
      return String(price);
    });
  }
  
  // Try extracting from outcomeTokens array
  if (!outcomePrices && Array.isArray(m.outcomeTokens) && m.outcomeTokens.length >= 2) {
    outcomePrices = m.outcomeTokens.map((token: any) => {
      const price = token.price || token.lastPrice || token.currentPrice || token.tokenPrice || '0.5';
      return String(price);
    });
  }
  
  // If still no prices, try to extract from other fields
  if (!outcomePrices && (m.yesPrice !== undefined || m.noPrice !== undefined)) {
    outcomePrices = [
      String(m.yesPrice || m.yes_price || m.YES || '0.5'),
      String(m.noPrice || m.no_price || m.NO || '0.5')
    ];
  }
  
  // Last resort: if we have outcomes but no prices, default to 50/50
  // BUT we'll mark this as invalid data later
  if (!outcomePrices && outcomes.length >= 2) {
    outcomePrices = ['0.5', '0.5'];
  }

  const marketId = m.id || m.condition_id || m.questionID || m.slug || `market-${Date.now()}-${Math.random()}`;
  const question = m.question || m.title || m.name || 'Untitled Market';
  
  // Extract category - try multiple fields and normalize
  let category = m.category || m.seriesSlug || m.series || m.groupItemTitle || m.tags?.[0] || '';
  category = category.toLowerCase().trim();
  
  // Normalize common category variations
  if (!category || category === 'general' || category === 'uncategorized') {
    // Try to infer category from question/description
    const questionLower = question.toLowerCase();
    const descriptionLower = ((m.description || m.desc || '')).toLowerCase();
    const combined = `${questionLower} ${descriptionLower}`;
    
    // Check against category keywords
    for (const catConfig of POLYMARKET_CATEGORIES) {
      if (catConfig.id === 'all') continue;
      for (const keyword of catConfig.keywords) {
        if (combined.includes(keyword.toLowerCase())) {
          category = catConfig.id;
          break;
        }
      }
      if (category && category !== 'general') break;
    }
    
    // If still no category, set to 'General'
    if (!category || category === 'general') {
      category = 'General';
    }
  }

  const mappedMarket = {
    id: marketId,
    slug: m.slug || m.id || marketId,
    question: question,
    description: m.description || m.desc || '',
    category: category,
    active: m.active !== false && m.active !== 'false',
    closed: m.closed === true || m.closed === 'true',
    outcomes,
    outcomePrices,
    volume: parseFloat(m.volume || m.volumeNum || m.totalVolume || m.volumeUSD || m.volume_usd || '0') || 0,
    liquidity: parseFloat(m.liquidity || m.liquidityNum || m.totalLiquidity || m.liquidityUSD || m.liquidity_usd || '0') || 0,
    endDate: m.end_date_iso || m.endDate || m.end_date || m.endDateISO,
    image: m.image || m.imageUrl || m.img,
  };
  
  // Log if critical data is missing for debugging
  if (!outcomePrices || outcomePrices.length < 2) {
    console.warn(`[mapMarket] Market ${marketId} missing outcomePrices:`, {
      hasOutcomePrices: !!outcomePrices,
      outcomePricesLength: outcomePrices?.length,
      rawPrices: pricesRaw,
      marketId
    });
  }
  
  if (mappedMarket.volume === 0 && mappedMarket.liquidity === 0) {
    console.warn(`[mapMarket] Market ${marketId} has zero volume and liquidity:`, {
      volume: mappedMarket.volume,
      liquidity: mappedMarket.liquidity,
      rawVolume: m.volume || m.volumeNum || m.totalVolume,
      rawLiquidity: m.liquidity || m.liquidityNum || m.totalLiquidity
    });
  }
  
  return mappedMarket;
}

/**
 * Check if a market has real data (not default/placeholder values)
 * Returns true if market has real probabilities, volume, or liquidity
 */
function hasRealMarketData(market: PolymarketMarket): boolean {
  // Calculate probabilities directly from outcomePrices
  let yesProb = 0.5;
  let noProb = 0.5;
  
  const prices = market.outcomePrices;
  if (prices && prices.length >= 2) {
    const yesPrice = parseFloat(prices[0]);
    const noPrice = parseFloat(prices[1]);
    
    if (!isNaN(yesPrice) && !isNaN(noPrice) && yesPrice >= 0 && noPrice >= 0) {
      const sum = yesPrice + noPrice;
      if (sum > 0) {
        yesProb = yesPrice / sum;
        noProb = noPrice / sum;
      }
    }
  }
  
  // Check if probabilities are real (not default 50/50)
  const isDefaultProb = Math.abs(yesProb - 0.5) < 0.001 && Math.abs(noProb - 0.5) < 0.001;
  
  // Market is valid if it has:
  // 1. Real probabilities (not 50/50 default) OR
  // 2. Volume > 0 OR
  // 3. Liquidity > 0
  return !isDefaultProb || market.volume > 0 || market.liquidity > 0;
}

/**
 * Filter markets to only include those with real data
 */
function filterMarketsWithRealData(markets: PolymarketMarket[]): PolymarketMarket[] {
  return markets.filter((market) => {
    const hasData = hasRealMarketData(market);
    if (!hasData) {
      // Calculate probabilities for logging
      let yesProb = 0.5;
      let noProb = 0.5;
      const prices = market.outcomePrices;
      if (prices && prices.length >= 2) {
        const yesPrice = parseFloat(prices[0]);
        const noPrice = parseFloat(prices[1]);
        if (!isNaN(yesPrice) && !isNaN(noPrice) && yesPrice >= 0 && noPrice >= 0) {
          const sum = yesPrice + noPrice;
          if (sum > 0) {
            yesProb = yesPrice / sum;
            noProb = noPrice / sum;
          }
        }
      }
      console.log(`[Polymarket API] Filtering out market ${market.id} - no real data (prob: ${yesProb.toFixed(3)}/${noProb.toFixed(3)}, vol: ${market.volume}, liq: ${market.liquidity})`);
    }
    return hasData;
  });
}

/**
 * Process raw API response into markets array
 */
function processMarketsResponse(data: unknown, cacheKey: string): PolymarketMarket[] {
  let marketsArray: unknown[] = [];
  if (Array.isArray(data)) {
    marketsArray = data;
  } else if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).results)) {
    marketsArray = (data as Record<string, unknown>).results as unknown[];
  } else if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).markets)) {
    marketsArray = (data as Record<string, unknown>).markets as unknown[];
  } else if (data && typeof data === 'object') {
    marketsArray = [data];
  }
  
  const markets = marketsArray.map(mapMarket).filter(Boolean) as PolymarketMarket[];
  const validMarkets = filterMarketsWithRealData(markets);
  
  if (validMarkets.length > 0) {
    cacheSet(cacheKey, validMarkets);
  }
  
  return validMarkets;
}

/**
 * Fetch markets from Polymarket API with comprehensive filtering
 * Makes direct API calls to Polymarket's gamma API
 */
export async function fetchMarkets(filters: MarketFilters = {}): Promise<PolymarketMarket[]> {
  const params: Record<string, string> = {
    closed: filters.closed === undefined ? 'false' : String(filters.closed),
    limit: String(filters.limit || 50),
  };

  // Try session cache first to avoid repeated spinners if the user revisits quickly
  const cacheKey = `markets:${JSON.stringify(filters || {})}`;
  const cached = cacheGet<PolymarketMarket[]>(cacheKey);
  if (cached && cached.length > 0) {
    console.log(`[Polymarket API] Cache hit for markets`, { filters, count: cached.length });
    return cached;
  }

  // Add query parameter (this is the search term)
  if (filters.query) {
    params._q = filters.query;
  }

  // Add category filter - use tag_id if available (Polymarket API standard)
  if (filters.tagId !== undefined && filters.tagId !== null) {
    params.tag_id = String(filters.tagId);
  } else if (filters.category) {
    params.category = filters.category;
  }

  // Add active filter
  if (filters.active !== undefined) {
    params.active = String(filters.active);
  }

  // Add date filters
  if (filters.startDateMin) {
    params.start_date_min = filters.startDateMin;
  }
  if (filters.startDateMax) {
    params.start_date_max = filters.startDateMax;
  }
  if (filters.endDateMin) {
    params.end_date_min = filters.endDateMin;
  }
  if (filters.endDateMax) {
    params.end_date_max = filters.endDateMax;
  }

  // Add volume/liquidity filters
  if (filters.minVolume) {
    params.min_volume = String(filters.minVolume);
  }
  if (filters.minLiquidity) {
    params.min_liquidity = String(filters.minLiquidity);
  }

  // Add ordering - Polymarket API uses different parameter names
  // Only include if orderBy is valid (volume, liquidity work, but 'created' might not)
  if (filters.orderBy) {
    // Map our orderBy values to API-compatible values
    const orderMap: Record<string, string> = {
      'volume': 'volume',
      'liquidity': 'liquidity',
      'endDate': 'endDate',
      'created': 'created', // Try it, but might not work
    };
    
    const apiOrder = orderMap[filters.orderBy];
    if (apiOrder) {
      // Try without order parameter first if it's 'created', use volume as fallback
      if (filters.orderBy === 'created') {
        // Don't add order for 'created' - API might not support it
        // We'll sort client-side instead
      } else {
        params.order = apiOrder;
        params.ascending = String(filters.ascending !== false);
      }
    }
  }

  // Add offset for pagination
  if (filters.offset) {
    params.offset = String(filters.offset);
  }

  // Add cache-busting timestamp with microsecond precision to ensure we always get the latest data
  // Use performance.now() for higher precision timing
  params._t = String(Date.now() + (typeof performance !== 'undefined' ? performance.now() : 0));
  // Add random component to prevent any caching
  params._r = String(Math.random());
  
  const qs = new URLSearchParams(params);
  const apiUrl = `${gammaBase}/markets?${qs.toString()}`;
  
  try {
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: { 
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    
    // Handle 304 Not Modified - this means we need to retry without cache headers
    // or the data hasn't changed (which is fine, but we need the data)
    if (res.status === 304) {
      // Retry with a fresh URL (add extra random param)
      const retryUrl = `${apiUrl}&_retry=${Date.now()}`;
      const retryRes = await fetch(retryUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'reload',
      });
      if (!retryRes.ok && retryRes.status !== 304) {
        throw new Error(`Polymarket API error: ${retryRes.status} ${retryRes.statusText}`);
      }
      if (retryRes.status === 304) {
        // If still 304, return empty and rely on cache
        const cached = cacheGet<PolymarketMarket[]>(cacheKey);
        if (cached) return cached;
        return [];
      }
      const data = await retryRes.json();
      return processMarketsResponse(data, cacheKey);
    }
    
    if (!res.ok) {
      throw new Error(`Polymarket API error: ${res.status} ${res.statusText}`);
    }
    
    const data = await res.json();
    return processMarketsResponse(data, cacheKey);
  } catch (error) {
    // On error, try to return cached data if available
    const cached = cacheGet<PolymarketMarket[]>(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }
    throw error;
  }
}

/**
 * Search markets with live results from Polymarket API
 * This function makes direct API calls to Polymarket to get real-time results
 */
export async function searchMarkets(
  query: string,
  additionalFilters?: Omit<MarketFilters, 'query'>
): Promise<{ markets: PolymarketMarket[]; hasMore: boolean }> {
  try {
    if (!query || query.trim().length === 0) {
      // If no query, fetch latest markets
      return fetchCuratedLatest().then(markets => ({
        markets,
        hasMore: markets.length >= 50,
      }));
    }

    const trimmedQuery = query.trim();
    console.log('[Polymarket Search] Searching for:', trimmedQuery);

    const filters: MarketFilters = {
      query: trimmedQuery,
      active: true,
      closed: false,
      limit: 100, // Fetch more results for better search coverage
      orderBy: 'volume', // Use volume since 'created' is not supported by API
      ascending: false,
      ...additionalFilters,
    };

    // Make direct API call to Polymarket
    const markets = await fetchMarkets(filters);
    console.log(`[Polymarket Search] Found ${markets.length} markets for query: "${trimmedQuery}"`);
    
    // Client-side filtering to ensure results are actually relevant to the search query
    const queryLower = trimmedQuery.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0); // Split into words
    
    // Filter markets to only include those that match the query
    const relevantMarkets = markets.filter(market => {
      const question = (market.question || '').toLowerCase();
      const description = (market.description || '').toLowerCase();
      const category = (market.category || '').toLowerCase();
      const combined = `${question} ${description} ${category}`;
      
      // Check if query appears as a whole phrase
      if (combined.includes(queryLower)) {
        return true;
      }
      
      // Check if all query words appear (for multi-word queries)
      if (queryWords.length > 1) {
        const allWordsMatch = queryWords.every(word => combined.includes(word));
        if (allWordsMatch) {
          return true;
        }
      }
      
      // Check if any significant word matches (for single word or if phrase doesn't match)
      for (const word of queryWords) {
        if (word.length >= 3) { // Only check words with 3+ characters
          // Use word boundary to avoid partial matches in the middle of words
          const wordRegex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          if (wordRegex.test(combined)) {
            return true;
          }
          // Also check for substring match as fallback
          if (combined.includes(word)) {
            return true;
          }
        }
      }
      
      return false;
    });
    
    console.log(`[Polymarket Search] Filtered to ${relevantMarkets.length} relevant markets (from ${markets.length} total)`);
    
    if (relevantMarkets.length === 0) {
      console.warn('[Polymarket Search] No relevant markets found, trying broader search');
      // Try a broader search without strict filters, but still filter client-side
      const broaderMarkets = await fetchMarkets({
        query: trimmedQuery,
        limit: 200, // Fetch more to account for filtering
      });
      
      // Filter broader results for relevance
      const broaderRelevant = broaderMarkets.filter(market => {
        const question = (market.question || '').toLowerCase();
        const description = (market.description || '').toLowerCase();
        const category = (market.category || '').toLowerCase();
        const combined = `${question} ${description} ${category}`;
        
        // More lenient matching for broader search
        if (combined.includes(queryLower)) return true;
        if (queryWords.length > 1 && queryWords.every(word => combined.includes(word))) return true;
        for (const word of queryWords) {
          if (word.length >= 3 && combined.includes(word)) return true;
        }
        return false;
      });
      
      if (broaderRelevant.length > 0) {
        console.log(`[Polymarket Search] Found ${broaderRelevant.length} relevant markets with broader search`);
        // Sort and return
        const sorted = broaderRelevant.sort((a, b) => {
          const aQuestion = (a.question || '').toLowerCase();
          const bQuestion = (b.question || '').toLowerCase();
          const aExactMatch = aQuestion.includes(queryLower) ? 1 : 0;
          const bExactMatch = bQuestion.includes(queryLower) ? 1 : 0;
          if (aExactMatch !== bExactMatch) return bExactMatch - aExactMatch;
          return (b.volume || 0) - (a.volume || 0);
        });
        return {
          markets: sorted.slice(0, 50),
          hasMore: sorted.length >= 50,
        };
      }
    }
    
    // Sort by relevance (query in question/description) and volume
    const sortedMarkets = relevantMarkets.sort((a, b) => {
      const aQuestion = (a.question || '').toLowerCase();
      const bQuestion = (b.question || '').toLowerCase();
      const aDesc = (a.description || '').toLowerCase();
      const bDesc = (b.description || '').toLowerCase();
      
      // Exact phrase match in question gets highest priority
      const aPhraseMatch = aQuestion.includes(queryLower) ? 2 : 0;
      const bPhraseMatch = bQuestion.includes(queryLower) ? 2 : 0;
      if (aPhraseMatch !== bPhraseMatch) return bPhraseMatch - aPhraseMatch;
      
      // Exact match in question gets high priority
      const aExactMatch = aQuestion.includes(queryLower) ? 1 : 0;
      const bExactMatch = bQuestion.includes(queryLower) ? 1 : 0;
      if (aExactMatch !== bExactMatch) return bExactMatch - aExactMatch;
      
      // Then check description matches
      const aDescMatch = aDesc.includes(queryLower) ? 0.5 : 0;
      const bDescMatch = bDesc.includes(queryLower) ? 0.5 : 0;
      if (aDescMatch !== bDescMatch) return bDescMatch - aDescMatch;
      
      // Count word matches for multi-word queries
      if (queryWords.length > 1) {
        const aWordMatches = queryWords.filter(word => aQuestion.includes(word) || aDesc.includes(word)).length;
        const bWordMatches = queryWords.filter(word => bQuestion.includes(word) || bDesc.includes(word)).length;
        if (aWordMatches !== bWordMatches) return bWordMatches - aWordMatches;
      }
      
      // Finally by volume
      return (b.volume || 0) - (a.volume || 0);
    });

    return {
      markets: sortedMarkets.slice(0, 50), // Limit to 50 results
      hasMore: sortedMarkets.length >= 50,
    };
  } catch (error) {
    console.error('[Polymarket Search] Error:', error);
    // Return empty result instead of throwing
    return { markets: [], hasMore: false };
  }
}

/**
 * Fetch latest curated markets with focus on January 2026 events
 */
/**
 * Helper function to check if a market matches a category
 * Made more lenient to ensure we get results, especially for categories without tag_id
 */
function marketMatchesCategory(market: PolymarketMarket, categoryConfig: typeof POLYMARKET_CATEGORIES[number]): boolean {
  if (categoryConfig.id === 'all') return true;
  
  const marketCategory = (market.category || '').toLowerCase().trim();
  const question = (market.question || '').toLowerCase();
  const description = (market.description || '').toLowerCase();
  const combined = `${question} ${description} ${marketCategory}`;
  
  // For categories without tag_id (Health, Weather, Economics), be more lenient
  const isTaglessCategory = categoryConfig.tagId === null || categoryConfig.tagId === undefined;
  
  // Check if category field directly matches
  if (marketCategory) {
    // Direct match
    if (marketCategory === categoryConfig.id.toLowerCase()) {
      return true;
    }
    
    // Check category values (partial match)
    for (const catValue of categoryConfig.categoryValues) {
      if (marketCategory.includes(catValue.toLowerCase()) || catValue.toLowerCase().includes(marketCategory)) {
        return true;
      }
    }
  }
  
  // Check if keywords appear in question/description
  let keywordMatches = 0;
  for (const keyword of categoryConfig.keywords) {
    const keywordLower = keyword.toLowerCase();
    // Check for word boundary matches (more accurate)
    const wordRegex = new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (wordRegex.test(combined)) {
      keywordMatches++;
      // For tagless categories, any keyword match is enough
      if (isTaglessCategory) {
        return true;
      }
      // For tag-based categories, require at least one match
      if (keywordMatches >= 1) {
        return true;
      }
    }
    // Also check for simple substring match as fallback (more lenient)
    if (combined.includes(keywordLower)) {
      keywordMatches++;
      if (isTaglessCategory || keywordMatches >= 1) {
        return true;
      }
    }
  }
  
  // For tagless categories, if we got results from query, be very lenient
  // Accept markets that match at least one keyword (already handled above)
  // But also accept if the query returned them (they're likely relevant)
  if (isTaglessCategory && keywordMatches === 0) {
    // Last resort: check if any part of the category name appears
    const categoryName = categoryConfig.label.toLowerCase();
    if (combined.includes(categoryName)) {
      return true;
    }
    
    // Also check for partial matches of category name
    const categoryWords = categoryName.split(' ');
    for (const word of categoryWords) {
      if (word.length > 3 && combined.includes(word)) {
        return true;
      }
    }
    
    // For Health: also check for medical-related terms
    if (categoryConfig.id === 'health') {
      const healthTerms = ['medical', 'medicine', 'hospital', 'doctor', 'patient', 'treatment', 'disease', 'illness'];
      for (const term of healthTerms) {
        if (combined.includes(term)) {
          return true;
        }
      }
    }
    
    // For Weather: also check for weather-related terms
    if (categoryConfig.id === 'weather') {
      const weatherTerms = ['temperature', 'rain', 'snow', 'storm', 'hurricane', 'tornado', 'climate'];
      for (const term of weatherTerms) {
        if (combined.includes(term)) {
          return true;
        }
      }
    }
    
    // For Economics: also check for economic terms
    if (categoryConfig.id === 'economics') {
      const econTerms = ['gdp', 'unemployment', 'inflation', 'economy', 'economic', 'recession', 'fed', 'federal reserve'];
      for (const term of econTerms) {
        if (combined.includes(term)) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Fetch available tags from Polymarket API
 * This can be used to discover tag_id values for categories
 */
export async function fetchTags(): Promise<Array<{ id: number; label: string; slug: string }>> {
  try {
    const apiUrl = `${gammaBase}/tags?limit=200&_t=${Date.now()}`;
    console.log('[Polymarket API] Fetching tags from:', apiUrl);
    
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: { 
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      },
      cache: 'no-store',
      credentials: 'omit',
    });
    
    if (!res.ok) {
      console.warn(`[Polymarket API] Tags fetch error ${res.status}`);
      return [];
    }
    
    const data = await res.json();
    const tags = Array.isArray(data) ? data : (data.results || data.tags || []);
    console.log(`[Polymarket API] Fetched ${tags.length} tags`);
    return tags.map((t: any) => ({
      id: t.id || t.tag_id,
      label: t.label || t.name || '',
      slug: t.slug || '',
    }));
  } catch (error) {
    console.error('[Polymarket API] Error fetching tags:', error);
    return [];
  }
}

/**
 * Fetch latest markets by category - optimized for real-time updates
 * Uses tag_id for accurate API-level filtering, with client-side filtering as backup
 */
/**
 * Fetch markets ending within 1 hour
 * Perfect for users who want to see quick settlements
 */
export async function fetchEndingSoonMarkets(limit: number = 50): Promise<PolymarketMarket[]> {
  try {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000); // Add 1 hour in milliseconds
    
    // Format as ISO strings for API
    const endDateMin = now.toISOString();
    const endDateMax = oneHourFromNow.toISOString();
    
    console.log(`[fetchEndingSoonMarkets] Fetching markets ending between ${endDateMin} and ${endDateMax}`);
    
    // Fetch markets with end date between now and 1 hour from now
    const markets = await fetchMarkets({
      active: true,
      closed: false,
      endDateMin: endDateMin,
      endDateMax: endDateMax,
      limit: limit * 2, // Fetch more to account for filtering
      orderBy: 'endDate',
      ascending: true, // Soonest first
    });
    
    // Additional client-side filtering to ensure they're really ending soon
    const nowTime = now.getTime();
    const oneHourTime = oneHourFromNow.getTime();
    
    const endingSoonMarkets = markets.filter(market => {
      if (!market.endDate) return false;
      
      try {
        const marketEndTime = new Date(market.endDate).getTime();
        // Market must end between now and 1 hour from now
        return marketEndTime >= nowTime && marketEndTime <= oneHourTime;
      } catch (error) {
        console.warn(`[fetchEndingSoonMarkets] Invalid endDate for market ${market.id}:`, market.endDate);
        return false;
      }
    });
    
    // Sort by end date (soonest first)
    endingSoonMarkets.sort((a, b) => {
      const dateA = a.endDate ? new Date(a.endDate).getTime() : Infinity;
      const dateB = b.endDate ? new Date(b.endDate).getTime() : Infinity;
      return dateA - dateB; // Soonest first
    });
    
    console.log(`[fetchEndingSoonMarkets] Found ${endingSoonMarkets.length} markets ending within 1 hour`);
    return endingSoonMarkets.slice(0, limit);
  } catch (error) {
    console.error('[fetchEndingSoonMarkets] Error fetching ending soon markets:', error);
    // Fallback: try without date filters
    try {
      const allMarkets = await fetchMarkets({
        active: true,
        closed: false,
        limit: limit * 3,
        orderBy: 'endDate',
        ascending: true,
      });
      
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const nowTime = now.getTime();
      const oneHourTime = oneHourFromNow.getTime();
      
      const endingSoon = allMarkets.filter(m => {
        if (!m.endDate) return false;
        const marketEndTime = new Date(m.endDate).getTime();
        return marketEndTime >= nowTime && marketEndTime <= oneHourTime;
      });
      
      endingSoon.sort((a, b) => {
        const dateA = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const dateB = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return dateA - dateB;
      });
      
      console.log(`[fetchEndingSoonMarkets] Fallback: Found ${endingSoon.length} markets ending within 1 hour`);
      return endingSoon.slice(0, limit);
    } catch (fallbackError) {
      console.error('[fetchEndingSoonMarkets] Fallback also failed:', fallbackError);
      return [];
    }
  }
}

export async function fetchMarketsByCategory(category: MarketCategory, limit: number = 50): Promise<PolymarketMarket[]> {
  // Handle special "ending-soon" category
  if (category === 'ending-soon') {
    return fetchEndingSoonMarkets(limit);
  }
  
  const categoryConfig = POLYMARKET_CATEGORIES.find(c => c.id === category);
  if (!categoryConfig || category === 'all') {
    // Fetch all markets, ordered by volume (API doesn't support 'created')
    try {
      const markets = await fetchMarkets({
        active: true,
        closed: false,
        limit,
        orderBy: 'volume',
        ascending: false,
      });
      // Sort by date client-side
      markets.sort((a, b) => {
        const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
        const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
        return dateB - dateA; // Newest first
      });
      console.log(`[fetchMarketsByCategory] All markets: ${markets.length}`);
      return markets;
    } catch (error) {
      console.error('[fetchMarketsByCategory] Error fetching all markets:', error);
      // Fallback: try without active filter
      const fallback = await fetchMarkets({
        closed: false,
        limit,
        orderBy: 'volume',
        ascending: false,
      });
      fallback.sort((a, b) => {
        const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
        const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
        return dateB - dateA;
      });
      return fallback;
    }
  }

  // For specific categories, use tag_id if available (most accurate)
  try {
    let markets: PolymarketMarket[] = [];
    
    // Primary method: Use tag_id if available (most accurate)
    if (categoryConfig.tagId !== null && categoryConfig.tagId !== undefined) {
      console.log(`[fetchMarketsByCategory] Fetching ${categoryConfig.label} using tag_id=${categoryConfig.tagId}`);
      try {
        markets = await fetchMarkets({
          tagId: categoryConfig.tagId,
          active: true,
          closed: false,
          limit: limit,
          // Don't use orderBy 'created' - API doesn't support it, sort client-side instead
          orderBy: 'volume',
          ascending: false,
        });
        console.log(`[fetchMarketsByCategory] ${categoryConfig.label} (tag_id): ${markets.length} markets`);
        
        // Sort by creation date client-side if we wanted 'created'
        markets.sort((a, b) => {
          const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
          const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
          return dateB - dateA; // Newest first
        });
        
        // If tag_id worked and we got results, return them (API already filtered correctly)
        if (markets.length > 0) {
          return markets.slice(0, limit);
        }
      } catch (error) {
        console.warn(`[fetchMarketsByCategory] tag_id fetch failed for ${categoryConfig.label}, trying fallback:`, error);
      }
    }
    
    // Fallback method: Use query if tag_id not available or if we got few results
    console.log(`[fetchMarketsByCategory] ${categoryConfig.label} using query method`);
    
    // For Health, Weather, Economics - skip query and go straight to broad fetch
    const isProblematicCategory = categoryConfig.id === 'health' || categoryConfig.id === 'weather' || categoryConfig.id === 'economics';
    
    // For categories without tag_id, try multiple query strategies
    let queryMarkets: PolymarketMarket[] = [];
    
    // For problematic categories, skip query and go straight to broad fetch
    if (!isProblematicCategory) {
      // Strategy 1: Try the main query (use first word, as API might not support multi-word queries)
      const mainQuery = categoryConfig.query.split(' ')[0]; // Use first word of query
      try {
        queryMarkets = await fetchMarkets({
          query: mainQuery,
          active: true,
          closed: false,
          limit: limit * 3, // Fetch more for client-side filtering
          orderBy: 'volume',
          ascending: false,
        });
        console.log(`[fetchMarketsByCategory] ${categoryConfig.label} (query: ${mainQuery}): ${queryMarkets.length} markets`);
      } catch (error) {
        console.warn(`[fetchMarketsByCategory] Query failed for ${categoryConfig.label}:`, error);
      }
      
      // Strategy 2: If we got few results, try without active filter
      if (queryMarkets.length < limit) {
        try {
          const additionalMarkets = await fetchMarkets({
            query: mainQuery,
            closed: false,
            limit: limit * 2,
            orderBy: 'volume',
            ascending: false,
          });
          
          // Merge and deduplicate
          const seen = new Set(queryMarkets.map(m => m.id));
          const newMarkets = additionalMarkets.filter(m => !seen.has(m.id));
          queryMarkets = [...queryMarkets, ...newMarkets];
          console.log(`[fetchMarketsByCategory] ${categoryConfig.label} (query fallback): ${additionalMarkets.length} additional markets`);
        } catch (error) {
          console.warn(`[fetchMarketsByCategory] Query fallback failed for ${categoryConfig.label}:`, error);
        }
      }
    }
    
    // Strategy 3: For categories without tag_id (especially Health), fetch ALL markets and filter client-side
    // This is a more reliable fallback when API queries don't work well
    // For Health, Weather, Economics - always do this as primary method
    if (isProblematicCategory || queryMarkets.length < limit / 2) {
      console.log(`[fetchMarketsByCategory] ${categoryConfig.label} trying broad fetch + client-side filter`);
      try {
        // For Health, Weather, Economics - fetch without any filters to get maximum results
        const fetchLimit = isProblematicCategory ? 1000 : 500;
        
        // Fetch a large set of markets without query filter
        const allMarkets = await fetchMarkets({
          active: true,
          closed: false,
          limit: fetchLimit, // Fetch many markets
          orderBy: 'volume',
          ascending: false,
        });
        
        console.log(`[fetchMarketsByCategory] ${categoryConfig.label} fetched ${allMarkets.length} total markets for filtering`);
        
        // Filter client-side using our matching function
        const filtered = allMarkets.filter(m => marketMatchesCategory(m, categoryConfig));
        
        // Merge with existing results
        const seen = new Set(queryMarkets.map(m => m.id));
        const newFiltered = filtered.filter(m => !seen.has(m.id));
        queryMarkets = [...queryMarkets, ...newFiltered];
        
        console.log(`[fetchMarketsByCategory] ${categoryConfig.label} (broad fetch): ${filtered.length} matched, ${newFiltered.length} new`);
      } catch (error) {
        console.warn(`[fetchMarketsByCategory] Broad fetch failed for ${categoryConfig.label}:`, error);
      }
    }
    
    // Strategy 4: Try keyword-based search if still not enough
    if (queryMarkets.length < limit / 2 && categoryConfig.keywords.length > 0) {
      // Try multiple top keywords
      const topKeywords = categoryConfig.keywords.slice(0, 5); // Try top 5 keywords
      for (const keyword of topKeywords) {
        if (queryMarkets.length >= limit) break;
        
        try {
          const keywordMarkets = await fetchMarkets({
            query: keyword,
            closed: false,
            limit: limit,
            orderBy: 'volume',
            ascending: false,
          });
          
          const seen = new Set(queryMarkets.map(m => m.id));
          const newMarkets = keywordMarkets.filter(m => !seen.has(m.id) && marketMatchesCategory(m, categoryConfig));
          queryMarkets = [...queryMarkets, ...newMarkets];
          console.log(`[fetchMarketsByCategory] ${categoryConfig.label} (keyword: ${keyword}): ${keywordMarkets.length} markets, ${newMarkets.length} matched`);
        } catch (error) {
          console.warn(`[fetchMarketsByCategory] Keyword search failed for ${categoryConfig.label} (${keyword}):`, error);
        }
      }
    }
    
    console.log(`[fetchMarketsByCategory] ${categoryConfig.label} (query total): ${queryMarkets.length} markets before filtering`);
    
    // Combine with tag_id results and deduplicate
    const seen = new Set(markets.map(m => m.id));
    const newMarkets = queryMarkets.filter(m => !seen.has(m.id));
    markets = [...markets, ...newMarkets];
    
    // Sort by date client-side (newest first)
    markets.sort((a, b) => {
      const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
      const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
      return dateB - dateA; // Newest first
    });
    
    // Client-side filtering for accuracy (especially for query-based results)
    let filteredMarkets = markets.filter(m => marketMatchesCategory(m, categoryConfig));
    console.log(`[fetchMarketsByCategory] ${categoryConfig.label}: ${filteredMarkets.length} markets after client-side filtering`);
    
    // If we still don't have enough, try fetching ALL markets and filtering (last resort for Health/Weather/Economics)
    if (filteredMarkets.length < limit / 2 && (categoryConfig.id === 'health' || categoryConfig.id === 'weather' || categoryConfig.id === 'economics')) {
      console.log(`[fetchMarketsByCategory] ${categoryConfig.label} using last resort: fetch all + very lenient filter`);
      try {
        // Fetch a very large batch without any filters - especially for Health
        const fetchLimit = categoryConfig.id === 'health' ? 1000 : 500;
        const allMarketsBroad = await fetchMarkets({
          closed: false,
          limit: fetchLimit, // Fetch a very large batch
          orderBy: 'volume',
          ascending: false,
        });
        
        console.log(`[fetchMarketsByCategory] ${categoryConfig.label} (last resort): fetched ${allMarketsBroad.length} markets for lenient filtering`);
        
        // Filter client-side with VERY lenient matching
        const broadFiltered = allMarketsBroad.filter(m => {
          // Very lenient matching for these categories
          const question = (m.question || '').toLowerCase();
          const description = (m.description || '').toLowerCase();
          const category = (m.category || '').toLowerCase();
          const combined = `${question} ${description} ${category}`;
          
          // Check if ANY keyword appears (even partial matches)
          for (const keyword of categoryConfig.keywords) {
            const keywordLower = keyword.toLowerCase();
            // Check for word boundary or substring match
            if (combined.includes(keywordLower)) {
              return true;
            }
          }
          
          // Check category name
          if (combined.includes(categoryConfig.label.toLowerCase())) {
            return true;
          }
          
    // For Health specifically, check for common health-related patterns (very lenient)
    if (categoryConfig.id === 'health') {
      const healthPatterns = [
        'health', 'medical', 'medicine', 'covid', 'vaccine', 'fda', 'drug', 'treatment', 
        'hospital', 'doctor', 'disease', 'illness', 'patient', 'surgery', 'therapy', 
        'clinic', 'prescription', 'medication', 'cure', 'symptom', 'infection', 'virus', 
        'cancer', 'diabetes', 'heart', 'blood', 'organ', 'transplant', 'mental health',
        'psychology', 'psychiatry', 'wellness', 'fitness', 'nutrition', 'diet', 'healthcare',
        'pharmaceutical', 'pharma', 'diagnosis', 'nurse', 'physician', 'surgeon', 'therapy',
        'recovery', 'heal', 'sick', 'ill', 'condition', 'disorder', 'syndrome', 'epidemic',
        'pandemic', 'outbreak', 'clinical', 'trial', 'research', 'study', 'test', 'scan',
        'x-ray', 'mri', 'surgery', 'operation', 'procedure', 'medication', 'pill', 'dose'
      ];
      for (const pattern of healthPatterns) {
        if (combined.includes(pattern.toLowerCase())) {
          return true;
        }
      }
      // Also check for partial matches of health-related words
      if (combined.match(/\b(health|medical|medicine|hospital|doctor|patient|disease|illness|covid|vaccine)\w*/i)) {
        return true;
      }
    }
          
          return false;
        });
        
        // Merge with existing
        const seen = new Set(filteredMarkets.map(m => m.id));
        const newBroad = broadFiltered.filter(m => !seen.has(m.id));
        filteredMarkets = [...filteredMarkets, ...newBroad];
        
        console.log(`[fetchMarketsByCategory] ${categoryConfig.label} (last resort): ${broadFiltered.length} matched from ${allMarketsBroad.length} total, ${newBroad.length} new`);
      } catch (error) {
        console.warn(`[fetchMarketsByCategory] Last resort failed for ${categoryConfig.label}:`, error);
      }
    }
    
    // If we have results, return them
    if (filteredMarkets.length > 0) {
      return filteredMarkets.slice(0, limit);
    }
    
    // Last resort for Health: if we still have 0 results after all strategies,
    // and we fetched markets in the broad fetch, return a sample of them
    // (better than showing nothing)
    if (categoryConfig.id === 'health' && queryMarkets.length > 0) {
      console.warn(`[fetchMarketsByCategory] Health: No markets matched filters, but we have ${queryMarkets.length} markets from broad fetch. Returning top ${limit} by volume.`);
      // Return top markets by volume as fallback
      return queryMarkets
        .sort((a, b) => (b.volume || 0) - (a.volume || 0))
        .slice(0, limit);
    }
    
    // If still not enough, try without active filter
    console.log(`[fetchMarketsByCategory] ${categoryConfig.label} trying without active filter`);
    let fallbackMarkets: PolymarketMarket[] = [];
    
    if (categoryConfig.tagId !== null && categoryConfig.tagId !== undefined) {
      fallbackMarkets = await fetchMarkets({
        tagId: categoryConfig.tagId,
        closed: false,
        limit: limit * 2,
        orderBy: 'volume',
        ascending: false,
      });
    } else {
      fallbackMarkets = await fetchMarkets({
        query: categoryConfig.query,
        closed: false,
        limit: limit * 2,
        orderBy: 'volume',
        ascending: false,
      });
    }
    
    // Sort fallback by date
    fallbackMarkets.sort((a, b) => {
      const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
      const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
      return dateB - dateA;
    });
    
    const seenFiltered = new Set(filteredMarkets.map(m => m.id));
    const newFallback = fallbackMarkets.filter(m => !seenFiltered.has(m.id) && marketMatchesCategory(m, categoryConfig));
    filteredMarkets.push(...newFallback);
    console.log(`[fetchMarketsByCategory] ${categoryConfig.label} (fallback): ${newFallback.length} additional markets`);
    
    // Remove duplicates and return
    const seenFinal = new Set<string>();
    const uniqueMarkets = filteredMarkets.filter(m => {
      if (seenFinal.has(m.id)) return false;
      seenFinal.add(m.id);
      return true;
    });
    
    console.log(`[fetchMarketsByCategory] ${categoryConfig.label} final: ${uniqueMarkets.length} unique markets`);
    return uniqueMarkets.slice(0, limit);
  } catch (error) {
    console.error(`[fetchMarketsByCategory] Error fetching ${categoryConfig.label}:`, error);
    // Return empty array on error
    return [];
  }
}

export async function fetchCuratedLatest(): Promise<PolymarketMarket[]> {
  const results: PolymarketMarket[] = [];
  const seen = new Set<string>();
  
  // Fetch MORE markets to catch new ones that might not be in top volume
  // Increased limit to ensure we capture newly created markets
  try {
    const allActiveMarkets = await fetchMarkets({
      active: true,
      closed: false,
      limit: 200, // Increased from 100 to catch more markets including new ones
      orderBy: 'volume',
      ascending: false,
    });
    
    console.log(`[fetchCuratedLatest] Fetched ${allActiveMarkets.length} active markets from API`);
    
    // Sort by endDate (newer end dates often indicate newer markets)
    // Also prioritize markets with recent end dates (upcoming events)
    const now = new Date().getTime();
    allActiveMarkets.sort((a, b) => {
      const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
      const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
      
      // Prioritize markets with end dates in the future (upcoming events)
      // These are more likely to be new markets
      const aIsUpcoming = dateA > now;
      const bIsUpcoming = dateB > now;
      
      if (aIsUpcoming && !bIsUpcoming) return -1; // a is upcoming, b is not
      if (!aIsUpcoming && bIsUpcoming) return 1;  // b is upcoming, a is not
      
      // Both upcoming or both past - sort by date (newer first)
      return dateB - dateA;
    });
    
    // Filter to get diverse markets with real data
    const filtered = allActiveMarkets
      .filter((m) => {
        if (seen.has(m.id)) return false;
        if (m.closed || !m.active) return false;
        // Only include markets with real data (volume or liquidity > 0, or real probabilities)
        const hasRealData = (m.volume && m.volume > 0) || (m.liquidity && m.liquidity > 0);
        if (!hasRealData) {
          // Check if probabilities are real (not default 50/50)
          const prices = m.outcomePrices;
          if (prices && prices.length >= 2) {
            const yesProb = parseFloat(prices[0]);
            const noProb = parseFloat(prices[1]);
            if (!isNaN(yesProb) && !isNaN(noProb) && yesProb >= 0 && noProb >= 0) {
              const sum = yesProb + noProb;
              if (sum > 0) {
                const yesP = yesProb / sum;
                const noP = noProb / sum;
                // If probabilities are not 50/50, it's real data
                if (Math.abs(yesP - 0.5) > 0.01 || Math.abs(noP - 0.5) > 0.01) {
                  seen.add(m.id);
                  return true;
                }
              }
            }
          }
          return false; // No real data
        }
        seen.add(m.id);
        return true;
      })
      .slice(0, 30); // Return more markets to show variety and catch new ones
    
    if (filtered.length > 0) {
      console.log(`[fetchCuratedLatest] Found ${filtered.length} active markets with real data`);
      return filtered;
    }
  } catch (err) {
    console.warn('[fetchCuratedLatest] Failed to fetch active markets:', err);
  }
  
  // Fallback: Get current date and fetch markets from now onwards (focus on upcoming events)
  // This helps catch new markets that might not have high volume yet
  const now = new Date();
  const startDate = now.toISOString();
  const endDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(); // Next 90 days
  
  // Helper function to check if market is recent (prefer current and upcoming events)
  // Made less restrictive to ensure we get markets
  const isRecentMarket = (market: PolymarketMarket): boolean => {
    // Always include markets without end dates (ongoing markets)
    if (!market.endDate) {
      return true;
    }
    
    try {
      const marketDate = new Date(market.endDate);
      const now = new Date();
      const daysDiff = (marketDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      
      // Include markets that are upcoming (within next 180 days) or recently closed (within last 30 days)
      if (daysDiff >= -30 && daysDiff <= 180) {
        return true;
      }
      // Also include markets that are not too far in the past (within last 60 days)
      if (daysDiff >= -60) {
        return true;
      }
    } catch {
      // If date parsing fails, include the market (might be ongoing)
      return true;
    }
    
    // For now, be more permissive - include all active markets
    return true;
  };
  
  // Helper function to filter out unwanted markets
  const isUnwantedMarket = (market: PolymarketMarket): boolean => {
    const question = (market.question || '').toLowerCase();
    const description = (market.description || '').toLowerCase();
    const combined = `${question} ${description}`;
    
    // Filter out specific political/war markets
    if (combined.includes('china') && combined.includes('taiwan')) return true;
    if (combined.includes('russia') && combined.includes('ukraine')) return true;
    if (combined.includes('invade')) return true;
    if (combined.includes('ceasefire')) return true;
    
    return false;
  };
  
  // Helper function to get date for sorting (prefer endDate, fallback to current date)
  const getSortDate = (market: PolymarketMarket): Date => {
    if (market.endDate) {
      try {
        const date = new Date(market.endDate);
        if (!isNaN(date.getTime())) return date;
      } catch {
        // Invalid date, fall through
      }
    }
    return new Date(); // Fallback to current date
  };
  
  // Helper function to calculate relevance score (higher = more relevant)
  const getRelevanceScore = (market: PolymarketMarket): number => {
    let score = 0;
    const now = new Date();
    
    // Markets with end dates closer to now get higher score (max 100 points)
    if (market.endDate) {
      try {
        const marketDate = new Date(market.endDate);
        const daysDiff = Math.abs((marketDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        // Closer to now = higher score (max 100 points, prefer upcoming events)
        if (daysDiff <= 30) {
          score += Math.max(0, 100 - daysDiff * 2); // Upcoming events get higher score
        } else if (daysDiff <= 90) {
          score += Math.max(0, 40 - (daysDiff - 30)); // Further out events get lower score
        }
      } catch {
        // Invalid date
      }
    } else {
      // Markets without end dates (ongoing) get medium score
      score += 50;
    }
    
    // Higher volume = higher score (max 50 points)
    score += Math.min(50, (market.volume || 0) / 10000);
    
    // Higher liquidity = higher score (max 30 points)
    score += Math.min(30, (market.liquidity || 0) / 5000);
    
    return score;
  };
  
  // Helper function to filter and sort markets
  const filterAndSort = (markets: PolymarketMarket[], take: number) => {
    return markets
      .filter((m) => {
        if (seen.has(m.id)) return false;
        // Only filter out closed markets, but be more lenient with active status
        if (m.closed) return false;
        // Don't filter by isRecentMarket if we have few results - be more permissive
        if (markets.length < 10 || isRecentMarket(m)) {
          if (!isUnwantedMarket(m)) {
            seen.add(m.id);
            return true;
          }
        }
        return false;
      })
      .sort((a, b) => {
        // First sort by relevance score
        const scoreA = getRelevanceScore(a);
        const scoreB = getRelevanceScore(b);
        if (scoreB !== scoreA) return scoreB - scoreA;
        
        // Then by date (latest first)
        const dateA = getSortDate(a).getTime();
        const dateB = getSortDate(b).getTime();
        if (dateB !== dateA) return dateB - dateA;
        
        // Finally by volume as tiebreaker
        return (b.volume || 0) - (a.volume || 0);
      })
      .slice(0, take);
  };
  
  // Try to fetch markets with date filters first (upcoming events focus)
  // Prioritize newest events by ordering by creation date
  try {
    const dateFilteredMarkets = await fetchMarkets({
      active: true,
      closed: false,
      endDateMin: startDate,
      endDateMax: endDate,
      limit: 100,
      orderBy: 'volume', // Use volume since 'created' not supported
      ascending: false,
    });
    
    // Sort by date client-side
    dateFilteredMarkets.sort((a, b) => {
      const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
      const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
      return dateB - dateA;
    });
    
    const filtered = filterAndSort(dateFilteredMarkets, 20);
    results.push(...filtered);
    console.log(`[fetchCuratedLatest] Date-filtered markets: ${filtered.length}`);
  } catch (err) {
    console.warn('[fetchCuratedLatest] Failed to fetch date-filtered markets:', err);
  }
  
  // If we don't have enough, fetch from diverse categories (newest first)
  if (results.length < 20) {
    const categories = [
      { query: 'crypto', take: 5 },
      { query: 'politics', take: 4 },
      { query: 'tech', take: 3 },
      { query: 'finance', take: 2 },
      { query: 'sports', take: 2 },
      { query: 'gaming', take: 2 },
      { query: 'entertainment', take: 1 },
      { query: 'health', take: 1 },
    ];
    
    for (const category of categories) {
      if (results.length >= 20) break;
      
      try {
        const markets = await fetchMarkets({ 
          query: category.query,
          active: true,
          closed: false,
          limit: 150,
          orderBy: 'volume', // Use volume since 'created' not supported
          ascending: false,
        });
        
        // Sort by date client-side
        markets.sort((a, b) => {
          const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
          const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
          return dateB - dateA;
        });
        
        const remaining = 20 - results.length;
        const take = Math.min(category.take, remaining);
        const filtered = filterAndSort(markets, take);
        results.push(...filtered);
      } catch (err) {
        console.warn(`Failed to fetch ${category.query} markets:`, err);
      }
    }
  }
  
  // If we still don't have 20, fetch without category filters (newest first)
  if (results.length < 20) {
    try {
      const allMarkets = await fetchMarkets({ 
        active: true,
        closed: false,
        limit: 200,
        orderBy: 'volume', // Use volume since 'created' not supported
        ascending: false,
      });
      
      // Sort by date client-side
      allMarkets.sort((a, b) => {
        const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
        const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
        return dateB - dateA; // Newest first
      });
      
      const remaining = 20 - results.length;
      const filtered = filterAndSort(allMarkets, remaining);
      results.push(...filtered);
      console.log(`[fetchCuratedLatest] Additional markets: ${filtered.length}`);
    } catch (err) {
      console.warn('[fetchCuratedLatest] Failed to fetch additional markets:', err);
    }
  }
  
  // Final fallback: if we still have no results, try with minimal filters
  if (results.length === 0) {
    try {
      console.log('[fetchCuratedLatest] Trying fallback: fetching with minimal filters');
      const fallbackMarkets = await fetchMarkets({ 
        limit: 50,
        orderBy: 'volume', // Order by volume as fallback
        ascending: false,
      });
      
      const filtered = fallbackMarkets
        .filter((m) => {
          if (seen.has(m.id)) return false;
          // Only exclude closed markets
          if (m.closed) return false;
          seen.add(m.id);
          return true;
        })
        .slice(0, 20);
      
      results.push(...filtered);
      console.log(`[fetchCuratedLatest] Fallback markets: ${filtered.length}`);
    } catch (err) {
      console.error('[fetchCuratedLatest] Fallback also failed:', err);
      // Last resort: try without any filters at all
      try {
        console.log('[fetchCuratedLatest] Last resort: fetching without any filters');
        const lastResortMarkets = await fetchMarkets({ 
          limit: 50,
        });
        const filtered = lastResortMarkets
          .filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          })
          .slice(0, 20);
        results.push(...filtered);
        console.log(`[fetchCuratedLatest] Last resort markets: ${filtered.length}`);
      } catch (lastErr) {
        console.error('[fetchCuratedLatest] Last resort also failed:', lastErr);
      }
    }
  }
  
  // Filter to only markets with real data
  const validResults = filterMarketsWithRealData(results);
  console.log(`[fetchCuratedLatest] Returning ${validResults.length} markets with real data (from ${results.length} total)`);
  
  // Sort by endDate to prioritize newer/upcoming markets (likely to be new markets)
  const sortedResults = validResults.sort((a, b) => {
    const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
    const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
    const now = Date.now();
    
    // Prioritize upcoming markets (newer markets often have future end dates)
    const aIsUpcoming = dateA > now;
    const bIsUpcoming = dateB > now;
    
    if (aIsUpcoming && !bIsUpcoming) return -1;
    if (!aIsUpcoming && bIsUpcoming) return 1;
    
    // Both upcoming or both past - sort by date (newer first)
    return dateB - dateA;
  });
  
  return sortedResults.slice(0, 30); // Return more markets to show variety and catch new ones
}

/**
 * Fetch market details directly from Polymarket API
 * Uses short TTL cache to reduce API calls while keeping data fresh
 */
const MARKET_DETAILS_CACHE_TTL = 3000; // 3 seconds for faster updates

// In-flight request deduplication
const inFlightRequests = new Map<string, Promise<PolymarketMarket | null>>();

export async function getMarketDetails(marketId: string): Promise<PolymarketMarket | null> {
  // Check cache first
  const cacheKey = `market:${marketId}`;
  const cached = cacheGet<PolymarketMarket>(cacheKey);
  if (cached) {
    return cached;
  }

  // Check if request is already in-flight (deduplication)
  const inFlight = inFlightRequests.get(marketId);
  if (inFlight) {
    return inFlight;
  }

  // Create the fetch promise
  const fetchPromise = (async (): Promise<PolymarketMarket | null> => {
    try {
      const res = await fetch(`${gammaBase}/markets/${marketId}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      
      // Handle 304 - return cached if available
      if (res.status === 304) {
        return cacheGet<PolymarketMarket>(cacheKey);
      }
      
      if (!res.ok) return null;
      
      const m = await res.json();
      const market = mapMarket(m);
      
      if (market) {
        cacheSet(cacheKey, market, MARKET_DETAILS_CACHE_TTL);
      }
      
      return market;
    } catch {
      // On error, return cached data if available
      return cacheGet<PolymarketMarket>(cacheKey);
    } finally {
      inFlightRequests.delete(marketId);
    }
  })();

  inFlightRequests.set(marketId, fetchPromise);
  return fetchPromise;
}

/**
 * Batch fetch multiple markets in parallel with concurrency limit
 */
export async function getMarketDetailsBatch(marketIds: string[]): Promise<Map<string, PolymarketMarket>> {
  const results = new Map<string, PolymarketMarket>();
  const uncachedIds: string[] = [];
  
  // First, check cache for all markets
  for (const id of marketIds) {
    const cached = cacheGet<PolymarketMarket>(`market:${id}`);
    if (cached) {
      results.set(id, cached);
    } else {
      uncachedIds.push(id);
    }
  }
  
  // Fetch uncached markets in parallel (max 6 concurrent)
  const CONCURRENCY = 6;
  for (let i = 0; i < uncachedIds.length; i += CONCURRENCY) {
    const batch = uncachedIds.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(batch.map(id => getMarketDetails(id)));
    batch.forEach((id, idx) => {
      if (fetched[idx]) results.set(id, fetched[idx]!);
    });
  }
  
  return results;
}

export function getOutcomeProbabilities(market: PolymarketMarket): OutcomeProbabilities {
  const prices = market.outcomePrices;
  if (prices && prices.length >= 2) {
    const yesProb = parseFloat(prices[0]);
    const noProb = parseFloat(prices[1]);
    
    // If we have valid probabilities, use them
    if (!isNaN(yesProb) && !isNaN(noProb) && yesProb >= 0 && noProb >= 0) {
      // Normalize if they don't sum to 1 (sometimes API returns prices that need normalization)
      const sum = yesProb + noProb;
      if (sum > 0) {
        return {
          YES: yesProb / sum,
          NO: noProb / sum,
        };
      }
    }
  }
  
  // Fallback: try to calculate from prices if available
  // If prices are in dollar format (e.g., $0.50), convert to probability
  // Otherwise default to 50/50
  console.warn(`[getOutcomeProbabilities] Market ${market.id} missing valid outcomePrices, using default 50/50`);
  return { YES: 0.5, NO: 0.5 };
}

export function formatVolume(volume: number): string {
  if (volume >= 1000000) return `$${(volume / 1000000).toFixed(1)}M`;
  if (volume >= 1000) return `$${(volume / 1000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}

export function formatProbability(prob: number): string {
  return `${(prob * 100).toFixed(1)}%`;
}

export function getOutcomePrices(market: PolymarketMarket): { YES: number; NO: number } | null {
  const prices = market.outcomePrices;
  if (prices && prices.length >= 2) {
    return {
      YES: parseFloat(prices[0]) || 0,
      NO: parseFloat(prices[1]) || 0,
    };
  }
  return null;
}

export function formatPrice(price: number): string {
  return `$${price.toFixed(4)}`;
}

export async function fetchMarketBySlug(slug: string): Promise<PolymarketMarket | null> {
  try {
    // Add cache-busting timestamp with microsecond precision
    const apiUrl = `${gammaBase}/markets/slug/${slug}?_t=${Date.now() + (typeof performance !== 'undefined' ? performance.now() : 0)}&_r=${Math.random()}`;
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: { 
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'If-None-Match': '*',
        'X-Requested-With': 'XMLHttpRequest',
      },
      cache: 'no-store',
      credentials: 'omit',
      ...(typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(10000) } : {}), // 10 second timeout
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    return mapMarket(data);
  } catch (error) {
    console.error('Failed to fetch market by slug:', error);
    return null;
  }
}
