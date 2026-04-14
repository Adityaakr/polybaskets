import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMemo, useState, useEffect, useDeferredValue } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBasketById, isFollowing, followBasket, unfollowBasket, getFollowerCount, deleteBasket } from '@/lib/basket-storage.ts';
import { searchMarkets, getOutcomeProbabilities, getOutcomePrices, getMarketDetailsBatch, formatProbability, formatPrice } from '@/lib/polymarket.ts';
import { OutcomeProbabilities, type PolymarketMarket } from '@/types/polymarket.ts';
import { calculateBasketIndex, truncateAddress, formatWeight, getChangeClass, getCreationSnapshotIndex } from '@/lib/basket-utils.ts';
import { useWallet } from '@/contexts/WalletContext';
import { useBasket } from '@/contexts/BasketContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { useApi, useAccount } from '@gear-js/react-hooks';
import { NETWORKS } from '@/lib/network.ts';
import { basketMarketProgramFromApi, toVara, fromVara, actorIdFromAddress } from '@/lib/varaClient.ts';
import { extractOnChainBasketId, fetchOnChainBasket, fetchOnChainPositions, fetchOnChainSettlement, getUserPositionForBasket, calculatePayout, onChainBasketToFrontend } from '@/lib/basket-onchain.ts';
import { ENV, isBasketAssetKindEnabled, isManualBettingEnabled, isVaraEnabled } from '@/env';
import { isFtAssetKind, normalizeAssetKind, type ContractBasketAssetKind } from '@/lib/assetKind.ts';
import { betLaneProgramFromApi, isBetProgramsConfigured, readSailsQuery } from '@/lib/betPrograms.ts';
import { useVaraEthBasketMarket } from '@/hooks/useVaraEthBasketMarket';
import { toWVara, fromWVara } from '@/lib/varaEthClient.ts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Basket } from '@/types/basket.ts';
import { 
  ArrowLeft, Heart, Copy, Share2, Circle, ExternalLink,
  Layers, Clock, Users, Check, Loader2, TrendingUp, Coins, AlertCircle, CheckCircle2, Trash2, Calculator, CheckCircle, XCircle, Trophy
} from 'lucide-react';
import { PayoutCelebration } from '@/components/PayoutCelebration';
import { BetLanePanel } from '@/components/BetLanePanel';
import { AgentTradingNotice } from '@/components/AgentTradingNotice';
import { useMarketsLivePrices } from '@/hooks/useMarketLivePrices';

const LOW_BASE_PROBABILITY_THRESHOLD = 0.05;
const DEBUG_BASKET_PAGE = false;

const debugBasketLog = (...args: unknown[]) => {
  if (DEBUG_BASKET_PAGE) {
    console.log(...args);
  }
};

const debugBasketWarn = (...args: unknown[]) => {
  if (DEBUG_BASKET_PAGE) {
    console.warn(...args);
  }
};

function getReadyOutcomeProbabilities(market: { outcomePrices?: string[] | null }): OutcomeProbabilities | null {
  const prices = market.outcomePrices;
  if (!prices || prices.length < 2) {
    return null;
  }

  const yesProb = Number.parseFloat(prices[0]);
  const noProb = Number.parseFloat(prices[1]);
  if (!Number.isFinite(yesProb) || !Number.isFinite(noProb) || yesProb < 0 || noProb < 0) {
    return null;
  }

  const sum = yesProb + noProb;
  if (sum <= 0) {
    return null;
  }

  return {
    YES: yesProb / sum,
    NO: noProb / sum,
  };
}

function getProbabilitiesFromPriceMap(prices: { YES: number; NO: number } | null | undefined): OutcomeProbabilities | null {
  if (!prices) {
    return null;
  }

  if (!Number.isFinite(prices.YES) || !Number.isFinite(prices.NO) || prices.YES < 0 || prices.NO < 0) {
    return null;
  }

  const sum = prices.YES + prices.NO;
  if (sum <= 0) {
    return null;
  }

  return {
    YES: prices.YES / sum,
    NO: prices.NO / sum,
  };
}

function formatDurationFromSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return '0 minutes';
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${Math.max(1, minutes)} minute${minutes === 1 ? '' : 's'}`;
}

function isCloneableMarket(market: PolymarketMarket): boolean {
  if (!market.active || market.closed || market.acceptingOrders === false) {
    return false;
  }

  if (!market.endDate) {
    return true;
  }

  const endTs = new Date(market.endDate).getTime();
  return !Number.isNaN(endTs) && endTs > Date.now();
}

type BasketItemChange = {
  currentProb: number;
  originalProb: number;
  change: number;
  changePercent: number | null;
  multiple: number | null;
  isLowBase: boolean;
};

type BasketItemRow = {
  key: string;
  item: Basket['items'][number];
  price: number | null;
  currentProb: number | null;
  change?: BasketItemChange;
  isPositive: boolean;
  polymarketUrl: string | null;
  marketStatus?: { closed: boolean; active: boolean; resolved?: 'YES' | 'NO' | null };
  isClosed: boolean;
  isResolved: boolean;
  resolvedOutcome?: 'YES' | 'NO' | null;
  weight: number;
  contribution: number | null;
  probChange: number;
};

type IndexedCreationReference = {
  index: number;
  timestamp: string | null;
};

const INDEXED_CREATION_REFERENCE_QUERY = `
  query IndexedCreationReference($basketId: String!) {
    allChipPositions(
      filter: { basketId: { equalTo: $basketId } }
      orderBy: UPDATED_AT_ASC
      first: 1
    ) {
      nodes {
        indexAtCreationBps
        updatedAt
      }
    }
  }
`;

async function fetchIndexedCreationReference(
  basketEntityId: string,
): Promise<IndexedCreationReference | null> {
  const response = await fetch(ENV.INDEXER_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: INDEXED_CREATION_REFERENCE_QUERY,
      variables: {
        basketId: basketEntityId,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Indexer GraphQL request failed: ${response.status}`);
  }

  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(body.errors[0].message ?? 'Indexer GraphQL error');
  }

  const node = body.data?.allChipPositions?.nodes?.[0];
  if (!node || typeof node.indexAtCreationBps !== 'number' || node.indexAtCreationBps <= 0) {
    return null;
  }

  return {
    index: node.indexAtCreationBps / 10000,
    timestamp: node.updatedAt ?? null,
  };
}

export default function BasketPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { address, connect } = useWallet();
  const { network } = useNetwork();
  const { api, isApiReady } = useApi();
  const { account } = useAccount();
  const { replaceDraft } = useBasket();
  const { toast } = useToast();
  const { basketMarket: varaEthBasketMarket, isLoading: isLoadingVaraEth } = useVaraEthBasketMarket();
  const [copied, setCopied] = useState(false);
  const varaEnabled = isVaraEnabled();
  const manualBettingEnabled = isManualBettingEnabled();
  
  const isVaraEth = network === 'varaeth';
  
  // On-chain state
  const [onChainBasket, setOnChainBasket] = useState<Basket | null>(null);
  const [userPosition, setUserPosition] = useState<Position | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [loadingOnChain, setLoadingOnChain] = useState(false);
  const [betting, setBetting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [cloningBasket, setCloningBasket] = useState(false);
  const [betAmount, setBetAmount] = useState('');
  
  // Payout celebration modal state
  const [showPayoutCelebration, setShowPayoutCelebration] = useState(false);
  const [claimedPayoutAmount, setClaimedPayoutAmount] = useState<string>('0');
  const [claimedTxHash, setClaimedTxHash] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const onChainId = id ? extractOnChainBasketId(id) : null;
  const isOnChain = onChainId !== null;

  // Get localStorage basket (for metadata if on-chain, or full basket if not)
  let localBasket: Basket | null = null;
  if (id && !isOnChain) {
    try {
      localBasket = getBasketById(id);
    } catch (storageError) {
      console.warn(`[BasketPage] Could not access localStorage for basket ${id}:`, storageError);
      localBasket = null;
    }
  }
  
  // Use on-chain basket if available, otherwise localStorage basket
  const basket = isOnChain ? onChainBasket : localBasket;
  const basketAssetKind = normalizeAssetKind(
    basket?.assetKind || ((basket as { asset_kind?: ContractBasketAssetKind } | null)?.asset_kind ?? 'Vara'),
  );
  const isFtAssetBasket = isFtAssetKind(basketAssetKind);
  const isNativeAssetBasket = !isFtAssetBasket;
  const isBasketSupportedInUi = isBasketAssetKindEnabled(basketAssetKind);
  const canUseNativeVaraFlow = varaEnabled && isNativeAssetBasket;
  const walletActorId = useMemo(
    () => (address && !isVaraEth ? actorIdFromAddress(address) : null),
    [address, isVaraEth],
  );
  const betLaneProgram = useMemo(() => {
    if (!api || !isApiReady || isVaraEth || !isOnChain || !isFtAssetBasket || !isBetProgramsConfigured()) {
      return null;
    }

    try {
      return betLaneProgramFromApi(api);
    } catch (err) {
      console.error('[BasketPage] Failed to create bet lane program:', err);
      return null;
    }
  }, [api, isApiReady, isFtAssetBasket, isOnChain, isVaraEth]);
  const lanePositionQuery = useQuery({
    queryKey: ['bet-lane-position', walletActorId, onChainId, betLaneProgram?.programId],
    enabled: !!betLaneProgram && !!walletActorId && onChainId !== null,
    queryFn: async () =>
      readSailsQuery(betLaneProgram!.betLane.getPosition(walletActorId!, onChainId!)),
    refetchInterval: 10_000,
  });
  const lanePosition = lanePositionQuery.data;
  const lanePositionEntryIndex = lanePosition?.index_at_creation_bps !== undefined
    ? lanePosition.index_at_creation_bps / 10000
    : null;
  const indexedCreationReferenceQuery = useQuery({
    queryKey: ['indexed-creation-reference', onChainId, ENV.PROGRAM_ID],
    enabled: isOnChain && onChainId !== null,
    queryFn: () =>
      fetchIndexedCreationReference(`${ENV.PROGRAM_ID}:${onChainId}`),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  
  // Safely get following status and followers count
  let following = false;
  let followers = 0;
  if (address && id) {
    try {
      following = isFollowing(address, id);
    } catch (storageError) {
      console.warn(`[BasketPage] Could not check following status:`, storageError);
    }
  }
  if (id) {
    try {
      followers = getFollowerCount(id);
    } catch (storageError) {
      console.warn(`[BasketPage] Could not get follower count:`, storageError);
    }
  }

  // Get program instance for on-chain operations (Vara Network only)
  // IMPORTANT: Include ENV.PROGRAM_ID in dependencies to ensure we use the current program ID
  const program = useMemo(() => {
    if (isVaraEth) return null; // Vara.eth uses varaEthBasketMarket instead
    if (api && isApiReady && isOnChain) {
      try {
        const programInstance = basketMarketProgramFromApi(api);
        console.log(`[BasketPage] Created program instance with ID: ${ENV.PROGRAM_ID?.slice(0, 20)}...`);
        return programInstance;
      } catch (err) {
        console.error('[BasketPage] Failed to create program:', err);
        return null;
      }
    }
    return null;
  }, [api, isApiReady, isOnChain, isVaraEth, ENV.PROGRAM_ID]);

  // Fetch on-chain data
  useEffect(() => {
    // IMPORTANT: Check for null explicitly, not falsy (0 is a valid basket ID)
    if (!isOnChain || onChainId === null) {
      console.log(`[BasketPage] Skipping fetch - isOnChain: ${isOnChain}, onChainId: ${onChainId}`);
      return;
    }
    if (isVaraEth && (!varaEthBasketMarket || isLoadingVaraEth)) {
      console.log(`[BasketPage] Skipping fetch - Vara.eth not ready:`, { hasMarket: !!varaEthBasketMarket, isLoading: isLoadingVaraEth });
      return;
    }
    if (!isVaraEth && !program) {
      console.log(`[BasketPage] Skipping fetch - Program not ready:`, { isVaraEth, hasProgram: !!program, isApiReady, api: !!api });
      return;
    }
    
    console.log(`[BasketPage] Starting fetch for basket onchain-${onChainId}`, {
      programId: ENV.PROGRAM_ID,
      programIdShort: ENV.PROGRAM_ID?.slice(0, 20) + '...',
      network,
      isVaraEth,
      configuredProgramId: ENV.PROGRAM_ID?.slice(0, 20) + '...'
    });

    // Verify program instance is using the configured env ID
    if (program && 'programId' in program) {
      const programInstanceId = (program as any).programId;
      if (programInstanceId !== ENV.PROGRAM_ID) {
        const errorMsg = `Program instance ID mismatch! Instance: ${programInstanceId?.slice(0, 20)}..., Env: ${ENV.PROGRAM_ID?.slice(0, 20)}...`;
        console.error(`[BasketPage] ${errorMsg}`);
        setError(errorMsg);
        setLoadingOnChain(false);
        return;
      }
      console.log(`[BasketPage] ✓ Program instance verified: ${programInstanceId.slice(0, 20)}...`);
    }

    const loadOnChainData = async () => {
      setLoadingOnChain(true);
      setError(null);
      
      try {
        let basketData: any;
        let positions: any[] = [];
        let settlementData: any = null;
        
        if (isVaraEth) {
          // Vara.eth network
          if (!varaEthBasketMarket) {
            throw new Error('Vara.eth basket market client not available');
          }
          
          const [basket, userPositions, settlement] = await Promise.all([
            varaEthBasketMarket.getBasket(BigInt(onChainId)),
            address ? varaEthBasketMarket.getPositions(address as `0x${string}`).catch(() => []) : Promise.resolve([]),
            varaEthBasketMarket.getSettlement(BigInt(onChainId)).catch(() => null),
          ]);
          
          basketData = { ok: basket };
          positions = userPositions;
          settlementData = settlement;
        } else {
          // Vara Network
          console.log(`[BasketPage] Fetching on-chain data for basket ${onChainId} (program: ${ENV.PROGRAM_ID?.slice(0, 10)}...)...`);
          
          // Try to fetch basket with fallback to .run() if .call() fails
          let basketResult: any;
          try {
            console.log(`[BasketPage] Attempting to fetch basket ${onChainId} using .call()...`);
            const query = program.basketMarket.getBasket(onChainId);
            basketResult = await query.call();
            console.log(`[BasketPage] Basket query (.call()) succeeded. Result type:`, typeof basketResult);
            console.log(`[BasketPage] Basket query (.call()) result:`, basketResult);
            console.log(`[BasketPage] Result keys:`, basketResult && typeof basketResult === 'object' ? Object.keys(basketResult) : 'N/A');
          } catch (callError: any) {
            console.log(`[BasketPage] .call() failed, trying .run()...`, callError);
            console.log(`[BasketPage] Call error details:`, {
              message: callError?.message,
              stack: callError?.stack,
              name: callError?.name
            });
            try {
              const query = program.basketMarket.getBasket(onChainId);
              basketResult = await query.run();
              console.log(`[BasketPage] Basket query (.run()) succeeded. Result:`, basketResult);
            } catch (runError: any) {
              console.error(`[BasketPage] Both .call() and .run() failed for basket ${onChainId}:`, runError);
              console.error(`[BasketPage] Run error details:`, {
                message: runError?.message,
                stack: runError?.stack,
                name: runError?.name
              });
              throw new Error(`Failed to fetch basket ${onChainId} from program ${ENV.PROGRAM_ID?.slice(0, 20)}.... Error: ${runError?.message || String(runError)}`);
            }
          }
          
          [basketData, positions, settlementData] = await Promise.all([
            Promise.resolve(basketResult),
            address ? fetchOnChainPositions(program, address).catch((err) => {
              console.error(`[BasketPage] Error fetching positions:`, err);
              return [];
            }) : Promise.resolve([]),
            fetchOnChainSettlement(program, onChainId).catch((err) => {
              console.error(`[BasketPage] Error fetching settlement:`, err);
              // Try alternative method
              return program.basketMarket.getSettlement(onChainId).call().then((result: any) => {
                if ('err' in result) {
                  console.log(`[BasketPage] Settlement query returned error:`, result.err);
                  return null;
                }
                return result.ok || result;
              }).catch((retryErr) => {
                console.error(`[BasketPage] Retry also failed:`, retryErr);
                return null;
              });
            }),
          ]);
          
          console.log(`[BasketPage] Fetched data:`, {
            hasBasket: !!basketData,
            positionsCount: positions?.length || 0,
            hasSettlement: !!settlementData,
            settlementStatus: settlementData?.status
          });
        }

        // Handle different response formats
        // The response can be:
        // 1. { err: "..." } - error
        // 2. { ok: { ...basket } } - success with wrapper
        // 3. { ...basket } - direct basket object
        // 4. result.ok already unwrapped
        let actualBasketData: any = null;
        
        console.log(`[BasketPage] Raw basketData received:`, {
          type: typeof basketData,
          isArray: Array.isArray(basketData),
          keys: basketData && typeof basketData === 'object' ? Object.keys(basketData) : 'N/A',
          hasErr: basketData && typeof basketData === 'object' && 'err' in basketData,
          hasOk: basketData && typeof basketData === 'object' && 'ok' in basketData,
          hasName: basketData && typeof basketData === 'object' && 'name' in basketData,
          hasItems: basketData && typeof basketData === 'object' && 'items' in basketData,
          fullData: basketData
        });
        
        if (basketData && typeof basketData === 'object') {
          if ('err' in basketData) {
            // Error response
            const errorMsg = typeof basketData.err === 'string' ? basketData.err : JSON.stringify(basketData.err);
            console.error(`[BasketPage] Basket query returned error:`, errorMsg);
            throw new Error(`Basket not found: ${errorMsg}`);
          } else if ('ok' in basketData) {
            // Success response with ok wrapper: { ok: { ...basket } }
            actualBasketData = basketData.ok;
            console.log(`[BasketPage] Found basket data in 'ok' wrapper`);
          } else if (basketData.name || basketData.items || basketData.id !== undefined) {
            // Direct basket object: { id, name, items, ... }
            actualBasketData = basketData;
            console.log(`[BasketPage] Found basket data as direct object`);
          } else {
            // Try to find basket data in nested structure
            // Sometimes the response might be nested differently
            for (const key in basketData) {
              const value = basketData[key];
              if (value && typeof value === 'object' && (value.name || value.items || value.id !== undefined)) {
                actualBasketData = value;
                console.log(`[BasketPage] Found basket data nested under key: ${key}`);
                break;
              }
            }
          }
        }
        
        if (!actualBasketData) {
          console.error(`[BasketPage] Invalid basket data format. Raw response:`, JSON.stringify(basketData, null, 2));
          console.error(`[BasketPage] Basket data type:`, typeof basketData);
          console.error(`[BasketPage] Basket data keys:`, basketData && typeof basketData === 'object' ? Object.keys(basketData) : 'null');
          throw new Error(`Basket ${onChainId} not found on current program. The basket may not exist or may be from a different program ID (${ENV.PROGRAM_ID?.slice(0, 10)}...).`);
        }
        
        // Validate that we have essential basket fields
        if (!actualBasketData.name && !actualBasketData.items) {
          console.error(`[BasketPage] Basket data missing essential fields:`, {
            hasName: !!actualBasketData.name,
            hasItems: !!actualBasketData.items,
            hasId: actualBasketData.id !== undefined,
            keys: Object.keys(actualBasketData)
          });
          throw new Error(`Basket ${onChainId} data is incomplete. Missing name or items.`);
        }
        
        console.log(`[BasketPage] ✓ Successfully parsed basket data:`, {
          id: actualBasketData.id,
          name: actualBasketData.name,
          itemsCount: actualBasketData.items?.length || 0,
          creator: actualBasketData.creator,
          status: actualBasketData.status,
          description: actualBasketData.description
        });
        
        // CRITICAL: Always use fresh on-chain data, never use localStorage for on-chain baskets
        // This ensures we're always showing data from the current program ID
        // localStorage might have stale data from the old program ID
        console.log(`[BasketPage] Loading basket ${id} (onchain-${onChainId}) from current program:`, {
          programId: ENV.PROGRAM_ID,
          onChainData: actualBasketData,
          basketName: actualBasketData.name,
          itemsCount: actualBasketData.items?.length || 0
        });
        
        // Get localStorage metadata only (tags, snapshot) - but don't use the basket data itself
        // This ensures we always use fresh on-chain data while preserving user metadata
        let localMeta: Basket | null = null;
        try {
          localMeta = getBasketById(id!);
          // Validate that localStorage basket is from the same program
          // If it's an old basket, ignore it completely
          if (localMeta && localMeta.id === id) {
            console.log(`[BasketPage] Found localStorage metadata for basket ${id}`);
          } else {
            console.log(`[BasketPage] localStorage basket doesn't match or is from old program, ignoring`);
            localMeta = null;
          }
        } catch (storageError) {
          console.warn(`[BasketPage] Could not access localStorage metadata:`, storageError);
          localMeta = null;
        }
        
        // ALWAYS convert from on-chain data - never use localStorage basket data
        // This ensures we're always showing data from the current program ID
        console.log(`[BasketPage] Converting from on-chain data (program: ${ENV.PROGRAM_ID?.slice(0, 20)}...)`);
        const converted = onChainBasketToFrontend(
          actualBasketData,
          onChainId,
          localMeta?.tags || [],
          localMeta?.createdSnapshot
        );
        
        console.log(`[BasketPage] ✓ Converted on-chain basket from current program:`, {
          id: converted.id,
          name: converted.name,
          itemsCount: converted.items.length,
          programId: ENV.PROGRAM_ID?.slice(0, 20) + '...',
          items: converted.items.map(i => ({ marketId: i.marketId, outcome: i.outcome, weightBps: i.weightBps }))
        });
        
        setOnChainBasket(converted);

        const resolvedBasket = basketData && typeof basketData === 'object' && 'ok' in basketData
          ? basketData.ok
          : basketData;
        const resolvedBasketAssetKind = normalizeAssetKind(
          resolvedBasket?.asset_kind || resolvedBasket?.assetKind || 'Vara',
        );
        const isResolvedFtBasket = resolvedBasketAssetKind === 'FT';

        // Find user's position
        // IMPORTANT: Handle basket ID 0 correctly - use strict equality, not falsy checks
        // For Vara.eth, positions are already filtered by basket_id in the response
        let userPos: any = null;
        if (isResolvedFtBasket) {
          console.log(
            `[BasketPage] Token-lane basket ${onChainId} uses lane positions; native program positions are not expected.`,
          );
        } else if (isVaraEth) {
          // For Vara.eth, ensure proper type conversion for basket ID 0
          userPos = positions.find((p: any) => {
            const pBasketId = typeof p.basket_id === 'bigint' ? Number(p.basket_id) : Number(p.basket_id);
            return pBasketId === onChainId;
          }) || null;
        } else {
          userPos = getUserPositionForBasket(positions, onChainId);
        }
        
        // Additional debug for basket ID 0
        if (onChainId === 0 && !userPos && positions.length > 0) {
          console.warn(`[BasketPage] ⚠️ No position found for basket ID 0, but user has ${positions.length} positions. Checking all positions:`, 
            positions.map((p: any) => ({
              basket_id: p.basket_id,
              basket_idType: typeof p.basket_id,
              basket_idNumber: typeof p.basket_id === 'bigint' ? Number(p.basket_id) : Number(p.basket_id),
              matchesZero: (typeof p.basket_id === 'bigint' ? Number(p.basket_id) : Number(p.basket_id)) === 0,
              shares: p.shares,
              index_at_creation_bps: p.index_at_creation_bps
            }))
          );
        }
        
        // Warn if position found but missing index_at_creation_bps (shouldn't happen with new contract)
        if (userPos && userPos.index_at_creation_bps === undefined) {
          console.warn(`[BasketPage] ⚠️ Position found for basket ${onChainId} but missing index_at_creation_bps! This is an old position from before the update.`);
        } else if (userPos && userPos.index_at_creation_bps !== undefined) {
          console.log(`[BasketPage] ✅ Position found with index_at_creation_bps: ${userPos.index_at_creation_bps} (${(userPos.index_at_creation_bps / 100).toFixed(2)}%)`);
        } else if (!userPos && positions.length === 0 && !isResolvedFtBasket) {
          console.warn(`[BasketPage] ⚠️ No positions found for user ${address?.slice(0, 10)}... on basket ${onChainId}. User may not have placed a bet.`);
        }
        
        console.log(`[BasketPage] Position lookup for basket ${onChainId}:`, {
          totalPositions: positions.length,
          userAddress: address,
          basketId: onChainId,
          basketIdType: typeof onChainId,
          foundPosition: !!userPos,
          positionDetails: userPos ? {
            basket_id: userPos.basket_id,
            basket_idType: typeof userPos.basket_id,
            basket_idNumber: Number(userPos.basket_id),
            shares: userPos.shares,
            claimed: userPos.claimed,
            index_at_creation_bps: userPos.index_at_creation_bps
          } : null,
          allPositions: positions.map((p: any) => ({
            basket_id: p.basket_id,
            basket_idType: typeof p.basket_id,
            basket_idNumber: Number(p.basket_id),
            basket_idMatches: Number(p.basket_id) === onChainId,
            shares: p.shares,
            user: typeof p.user === 'object' ? '0x...' : String(p.user).slice(0, 10) + '...'
          })),
          comparisonTest: positions.map((p: any) => ({
            basket_id: p.basket_id,
            Number_basket_id: Number(p.basket_id),
            onChainId: onChainId,
            matches: Number(p.basket_id) === onChainId,
            strictEqual: Number(p.basket_id) === onChainId
          }))
        });
        
        // Additional debug for basket ID 0 specifically
        if (onChainId === 0) {
          console.log(`[BasketPage] 🔍 Special debug for basket ID 0:`, {
            positionsArray: positions,
            positionsLength: positions.length,
            userAddress: address,
            filteredForZero: positions.filter((p: any) => Number(p.basket_id) === 0),
            allBasketIds: positions.map((p: any) => ({
              raw: p.basket_id,
              number: Number(p.basket_id),
              type: typeof p.basket_id
            }))
          });
        }
        
        setUserPosition(userPos || null);

        // Set settlement
        // Normalize settlement status if it's an enum object
        if (settlementData) {
          let normalizedStatus = settlementData.status;
          // Handle enum objects from sails-js (e.g., { Finalized: null } or "Finalized")
          if (typeof normalizedStatus === 'object' && normalizedStatus !== null) {
            // Extract the key from enum object like { Finalized: null }
            normalizedStatus = Object.keys(normalizedStatus)[0] || normalizedStatus;
          }
          settlementData = {
            ...settlementData,
            status: normalizedStatus as 'Proposed' | 'Finalized'
          };
          
          console.log('[BasketPage] ✓ Settlement data loaded:', {
            basketId: onChainId,
            status: settlementData.status,
            statusType: typeof settlementData.status,
            finalized_at: settlementData.finalized_at,
            proposed_at: settlementData.proposed_at,
            challenge_deadline: settlementData.challenge_deadline,
            payout_per_share: settlementData.payout_per_share,
            hasUserPosition: !!userPos,
            userPositionClaimed: userPos?.claimed,
            canClaim: isOnChain && settlementData.status === 'Finalized' && userPos && !userPos.claimed
          });
        } else {
          console.log(`[BasketPage] ⚠️ No settlement data found for basket ${onChainId}. This could mean:`);
          console.log(`  - Settlement hasn't been proposed yet`);
          console.log(`  - Settlement query failed silently`);
          console.log(`  - Basket doesn't have a settlement`);
        }
        setSettlement(settlementData);
      } catch (err) {
        console.error('[BasketPage] Error loading on-chain data:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to load basket data';
        setError(errorMessage);
        // Clear basket state on error so "Basket Not Found" is shown
        setOnChainBasket(null);
        console.error(`[BasketPage] Failed to load basket onchain-${onChainId}:`, {
          error: errorMessage,
          programId: ENV.PROGRAM_ID?.slice(0, 10) + '...',
          basketId: onChainId
        });
      } finally {
        setLoadingOnChain(false);
      }
    };

    loadOnChainData();
    // Refresh every 10 seconds
    const interval = setInterval(loadOnChainData, 10000);
    return () => clearInterval(interval);
  }, [isOnChain, onChainId, program, varaEthBasketMarket, isLoadingVaraEth, address, id, isVaraEth, ENV.PROGRAM_ID]);

  // Normalize settlement status for comparison (must be before early returns)
  const settlementStatus = useMemo(() => {
    if (!settlement?.status) return null;
    return typeof settlement.status === 'object' && settlement.status !== null 
      ? Object.keys(settlement.status)[0] 
      : settlement.status;
  }, [settlement?.status]);
  const challengeWindowLabel = useMemo(() => {
    if (!settlement) {
      return null;
    }

    const proposedAt = Number(settlement.proposed_at);
    const challengeDeadline = Number(settlement.challenge_deadline);

    if (!Number.isFinite(proposedAt) || !Number.isFinite(challengeDeadline) || challengeDeadline <= proposedAt) {
      return null;
    }

    return formatDurationFromSeconds(challengeDeadline - proposedAt);
  }, [settlement]);
  const settlementIndex = useMemo(() => {
    if (!settlement || settlementStatus !== 'Finalized') {
      return null;
    }

    const value = Number(settlement.payout_per_share) / 10000;
    return Number.isFinite(value) && value >= 0 ? value : null;
  }, [settlement, settlementStatus]);
  
  // Calculate expected payout (must be before early returns)
  // Note: expectedPayout can be "0" (string) for total losses, which is valid
  const expectedPayout = settlement && userPosition ? calculatePayout(settlement, userPosition) : null;
  const expectedPayoutNum = expectedPayout !== null ? parseFloat(expectedPayout) : 0;

  // Fetch individual market details for basket items (same strategy as BasketCard)
  // IMPORTANT: Use basket.items directly (not basket?.items) to match BasketCard exactly
  const basketMarketIds = useMemo(() => {
    if (!basket || !basket.items || basket.items.length === 0) {
      debugBasketWarn(`[BasketPage] No basket or items available. Basket:`, basket);
      return [];
    }
    const ids = basket.items.map(item => item.marketId).filter((id, idx, arr) => arr.indexOf(id) === idx);
    return ids;
  }, [basket?.items, basket?.id]);

  const basketMarketIdsKey = useMemo(
    () => [...basketMarketIds].sort().join(','),
    [basketMarketIds],
  );

  const { data: itemMarketsData } = useQuery({
    queryKey: ['market-details', basketMarketIdsKey],
    queryFn: async () => getMarketDetailsBatch(basketMarketIds),
    enabled: basketMarketIds.length > 0 && !!basket && !loadingOnChain,
    staleTime: 0, // Always consider data stale - fetch fresh data immediately
    refetchInterval: settlementStatus === 'Finalized' ? false : 2000, // Freeze market polling once settlement is final
    refetchIntervalInBackground: settlementStatus !== 'Finalized', // No need to keep polling finalized baskets
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchOnMount: true, // Always refetch on mount
    gcTime: 5000, // Keep in cache for only 5 seconds
    retry: 2, // Retry failed requests
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000), // Exponential backoff
  });

  const itemMarkets = useMemo(() => Array.from(itemMarketsData?.values() ?? []), [itemMarketsData]);
  const liveMarketPricesById = useMarketsLivePrices(settlementStatus === 'Finalized' ? [] : itemMarkets);
  const snapshotComponentsByIndex = useMemo(
    () => new Map((basket?.createdSnapshot?.components ?? []).map((component) => [component.itemIndex, component])),
    [basket?.createdSnapshot?.components],
  );

  const { liveIndex, probabilities, marketPrices, marketStatuses, hasValidData } = useMemo(() => {
    if (!basket) {
      debugBasketWarn(`[BasketPage] No basket available - basket is null`);
      return { liveIndex: 0, probabilities: [] as Array<number | null>, marketPrices: new Map(), marketStatuses: new Map(), hasValidData: false };
    }

    const snapshotIndex = getCreationSnapshotIndex(basket);
    
    if (!basket.items || basket.items.length === 0) {
      debugBasketWarn(`[BasketPage] Basket ${basket.id} has no items`);
      return { liveIndex: 0, probabilities: [] as Array<number | null>, marketPrices: new Map(), marketStatuses: new Map(), hasValidData: false };
    }

    // CRITICAL: Only calculate if we have REAL live data for ALL markets
    // Never use snapshot as "live" index - that causes wrong percentage calculations
    if (!itemMarketsData || itemMarketsData.size === 0 || basket.items.length === 0) {
      debugBasketWarn(`[BasketPage] No live data for basket ${basket.id} - cannot calculate accurate live index`);
      return { 
        liveIndex: snapshotIndex ?? 0, // Only for display, NOT for percentage calculation
        probabilities: basket.items.map(() => null),
        marketPrices: new Map(),
        marketStatuses: new Map(),
        hasValidData: false // Mark as invalid - don't calculate percentage
      };
    }

    // Check if we have data for all markets - if not, calculation will be inaccurate
    const missingMarkets = basket.items.filter(item => !itemMarketsData.has(item.marketId));
    if (missingMarkets.length > 0) {
      debugBasketWarn(`[BasketPage] Missing live data for ${missingMarkets.length} markets in basket ${basket.id}:`, missingMarkets.map(m => m.marketId));
      // Still calculate but mark as potentially inaccurate
    }

    const probMap = new Map<string, OutcomeProbabilities>();
    const priceMap = new Map<string, { YES: number; NO: number }>();
    const statusMap = new Map<string, { closed: boolean; active: boolean; resolved?: 'YES' | 'NO' | null }>();

    // Use ONLY live data from Polymarket API - NO static/mock data
    itemMarketsData.forEach((market, id) => {
      if (!market) {
        debugBasketWarn(`[BasketPage] Null market data for ${id}`);
        return;
      }
      
      const apiPrices = getOutcomePrices(market);
      const effectivePrices = market.closed
        ? apiPrices
        : liveMarketPricesById.get(id) ?? apiPrices;
      const probs = getProbabilitiesFromPriceMap(effectivePrices) ?? getOutcomeProbabilities(market);
      
      // Determine if market is resolved
      let resolved: 'YES' | 'NO' | null = null;
      if (market.closed && effectivePrices) {
        const yesPrice = effectivePrices.YES;
        const noPrice = effectivePrices.NO;
        if (yesPrice >= 0.99 && noPrice <= 0.01) {
          resolved = 'YES';
        } else if (noPrice >= 0.99 && yesPrice <= 0.01) {
          resolved = 'NO';
        }
      }
      
      probMap.set(id, probs);
      if (effectivePrices) {
        priceMap.set(id, effectivePrices);
      }
      statusMap.set(id, {
        closed: market.closed,
        active: market.active,
        resolved,
      });
    });

    // Calculate live index from REAL market data ONLY
    const calculatedIndex = calculateBasketIndex(basket.items, probMap);

    // Calculate probabilities for display from LIVE data
    const probs = basket.items.map(item => {
      const marketProbs = probMap.get(item.marketId);
      // Only expose probabilities that are actually backed by live market data.
      return marketProbs 
        ? (item.outcome === 'YES' ? marketProbs.YES : marketProbs.NO)
        : null;
    });

    // Only mark as valid if we have data for all or most markets
    return { 
      liveIndex: calculatedIndex, 
      probabilities: probs, 
      marketPrices: priceMap, 
      marketStatuses: statusMap,
      hasValidData: missingMarkets.length === 0
    };
  }, [basket, itemMarketsData, liveMarketPricesById]);
  const usesSettlementIndex = settlementIndex !== null;
  const displayedIndex = settlementIndex ?? liveIndex;
  const displayedIndexLabel = usesSettlementIndex ? 'Settlement Index (Final)' : 'Current Index (Live)';
  const displayedIndexDescription = usesSettlementIndex
    ? `${(displayedIndex * 100).toFixed(2)}% from on-chain settlement`
    : `${(displayedIndex * 100).toFixed(2)}% weighted probability`;

  // Calculate per-item changes since creation
  const itemChanges = useMemo(() => {
    if (!basket?.createdSnapshot?.components || !itemMarketsData || itemMarketsData.size === 0) {
      return new Map<number, {
        currentProb: number;
        originalProb: number;
        change: number;
        changePercent: number | null;
        multiple: number | null;
        isLowBase: boolean;
      }>();
    }

    const changes = new Map<number, {
      currentProb: number;
      originalProb: number;
      change: number;
      changePercent: number | null;
      multiple: number | null;
      isLowBase: boolean;
    }>();
    
    basket.items.forEach((item, itemIndex) => {
      const market = itemMarketsData.get(item.marketId);
      if (!market) {
        return;
      }

      const apiPrices = getOutcomePrices(market);
      const marketProbs = getProbabilitiesFromPriceMap(
        market.closed ? apiPrices : liveMarketPricesById.get(item.marketId) ?? apiPrices,
      ) ?? getReadyOutcomeProbabilities(market);
      if (!marketProbs) {
        return;
      }

      const snapshotComponent = snapshotComponentsByIndex.get(itemIndex);
      if (!snapshotComponent) {
        return;
      }

      const currentProb = item.outcome === 'YES' ? marketProbs.YES : marketProbs.NO;
      const originalProb = snapshotComponent.prob;
      
      const change = currentProb - originalProb;
      const isLowBase = originalProb > 0 && originalProb < LOW_BASE_PROBABILITY_THRESHOLD;
      const changePercent = change * 100;
      const multiple = originalProb > 0 && isLowBase
        ? currentProb / originalProb
        : null;

      changes.set(itemIndex, {
        currentProb,
        originalProb,
        change,
        changePercent,
        multiple,
        isLowBase,
      });
    });

    return changes;
  }, [basket, itemMarketsData, liveMarketPricesById, snapshotComponentsByIndex]);
  const basketItemRows = useMemo(() => {
    if (!basket) {
      return [] as BasketItemRow[];
    }

    const settlementResolutionsByIndex = new Map(
      usesSettlementIndex
        ? (settlement?.item_resolutions ?? []).map((resolution) => [resolution.item_index, resolution])
        : [],
    );

    return basket.items.map((item, index) => {
      const settlementResolution = settlementResolutionsByIndex.get(index);
      const hasFinalResolution = Boolean(settlementResolution);
      const resolutionPrices = settlementResolution
        ? {
            YES: settlementResolution.poly_price_yes / 10000,
            NO: settlementResolution.poly_price_no / 10000,
          }
        : null;
      const prices = hasFinalResolution
        ? resolutionPrices
        : marketPrices.get(item.marketId) ?? null;
      const price = prices ? (item.outcome === 'YES' ? prices.YES : prices.NO) : null;
      const currentProb = prices ? (item.outcome === 'YES' ? prices.YES : prices.NO) : probabilities[index];
      const fallbackChange = itemChanges.get(index);
      const snapshotComponent = snapshotComponentsByIndex.get(index);
      const change = hasFinalResolution && snapshotComponent
        ? {
            currentProb: currentProb ?? 0,
            originalProb: snapshotComponent.prob,
            change: (currentProb ?? 0) - snapshotComponent.prob,
            changePercent: ((currentProb ?? 0) - snapshotComponent.prob) * 100,
            multiple: snapshotComponent.prob > 0 && snapshotComponent.prob < LOW_BASE_PROBABILITY_THRESHOLD
              ? (currentProb ?? 0) / snapshotComponent.prob
              : null,
            isLowBase: snapshotComponent.prob > 0 && snapshotComponent.prob < LOW_BASE_PROBABILITY_THRESHOLD,
          }
        : fallbackChange;
      const polymarketUrl = item.slug ? `https://polymarket.com/event/${item.slug}` : null;
      const marketStatus = hasFinalResolution
        ? {
            closed: true,
            active: false,
            resolved: settlementResolution?.resolved ?? null,
          }
        : marketStatuses.get(item.marketId);
      const isClosed = marketStatus?.closed ?? false;
      const isResolved = marketStatus?.resolved !== null && marketStatus?.resolved !== undefined;
      const resolvedOutcome = marketStatus?.resolved;
      const weight = item.weightBps / 10000;
      const contribution = currentProb !== null ? weight * currentProb : null;
      const probChange = change ? change.change : 0;

      return {
        key: `${item.marketId}-${item.outcome}`,
        item,
        price,
        currentProb,
        change,
        isPositive: change ? change.change >= 0 : false,
        polymarketUrl,
        marketStatus,
        isClosed,
        isResolved,
        resolvedOutcome,
        weight,
        contribution,
        probChange,
      };
    });
  }, [basket, usesSettlementIndex, settlement?.item_resolutions, marketPrices, probabilities, itemChanges, marketStatuses, snapshotComponentsByIndex]);
  const deferredBasketItemRows = useDeferredValue(basketItemRows);
  const isBasketItemsRefreshing = deferredBasketItemRows !== basketItemRows;
  const hasFinalItemResolutions = usesSettlementIndex && deferredBasketItemRows.some((row) => row.isResolved);
  const basketStatusSummary = useMemo(() => {
    const resolvedCount = deferredBasketItemRows.filter((row) => row.isResolved).length;
    const closedUnresolvedCount = deferredBasketItemRows.filter((row) => row.isClosed && !row.isResolved).length;
    const openCount = deferredBasketItemRows.length - resolvedCount - closedUnresolvedCount;

    return {
      resolvedCount,
      closedUnresolvedCount,
      openCount,
    };
  }, [deferredBasketItemRows]);

  const localCreationSnapshotIndex = getCreationSnapshotIndex(basket);
  const creationReference = localCreationSnapshotIndex !== null
    ? {
        index: localCreationSnapshotIndex,
        timestamp: basket?.createdSnapshot?.timestamp
          ? new Date(basket.createdSnapshot.timestamp).toISOString()
          : null,
        source: 'snapshot' as const,
      }
    : indexedCreationReferenceQuery.data
      ? {
          index: indexedCreationReferenceQuery.data.index,
          timestamp: indexedCreationReferenceQuery.data.timestamp,
          source: 'indexed_position' as const,
        }
      : null;
  const creationSnapshotIndex = creationReference?.index ?? null;
  const creationReferenceTimestamp = creationReference?.timestamp ?? null;
  const creationReferenceSource = creationReference?.source ?? null;
  const creationReferenceLabel = creationReferenceSource === 'indexed_position'
    ? 'First indexed position reference'
    : 'Basket creation index';
  const creationReferenceDescription = creationSnapshotIndex !== null
    ? creationReferenceSource === 'indexed_position'
      ? `${(creationSnapshotIndex * 100).toFixed(2)}% from earliest indexed CHIP position`
      : `${(creationSnapshotIndex * 100).toFixed(2)}% from saved snapshot`
    : null;
  const nativePositionEntryIndex = userPosition?.index_at_creation_bps !== undefined
    ? userPosition.index_at_creation_bps / 10000
    : null;
  const positionEntryIndex = isFtAssetBasket ? lanePositionEntryIndex : nativePositionEntryIndex;
  const payoutReferenceIndex = positionEntryIndex ?? creationSnapshotIndex ?? 0;
  const entryIndexSource = isFtAssetBasket ? 'CHIP lane position' : 'on-chain position';
  const entryIndexBps = isFtAssetBasket ? lanePosition?.index_at_creation_bps : userPosition?.index_at_creation_bps;

  if (positionEntryIndex !== null) {
    debugBasketLog(
      `[BasketPage] Position entry index from ${entryIndexSource}: ${entryIndexBps} bps = ${positionEntryIndex.toFixed(4)}`,
    );
  }

  if (creationSnapshotIndex !== null) {
    debugBasketLog(`[BasketPage] Basket creation snapshot index from local metadata: ${creationSnapshotIndex.toFixed(4)}`);
  } else if (basket) {
    debugBasketWarn(`[BasketPage] No basket creation snapshot available for ${basket.id}. Hiding "since creation" calculations.`);
  }

  // Only calculate displayed change if we have complete live data and a real basket creation snapshot.
  let indexChange = 0;
  let indexChangePercent = 0;
  let stakeReturnPercent = 0;
  const isLowBaseIndex = creationSnapshotIndex !== null
    && creationSnapshotIndex > 0
    && creationSnapshotIndex < LOW_BASE_PROBABILITY_THRESHOLD;
  const indexGrowthMultiple = isLowBaseIndex && creationSnapshotIndex
    ? displayedIndex / creationSnapshotIndex
    : null;
  
  if ((usesSettlementIndex || hasValidData) && creationSnapshotIndex !== null && basket) {
    indexChange = displayedIndex - creationSnapshotIndex;
    indexChangePercent = indexChange * 100;
    
    if (isNaN(indexChangePercent) || !isFinite(indexChangePercent)) {
      console.error(`[BasketPage] Invalid index delta calculation for ${basket.id}:`, {
        displayedIndex,
        creationSnapshotIndex,
        indexChange,
        indexChangePercent
      });
      indexChangePercent = 0;
    }
  } else {
    if (!hasValidData) {
      debugBasketWarn(`[BasketPage] Cannot calculate accurate index delta for ${basket?.id} - incomplete live market data`);
    }
    if (creationSnapshotIndex === null) {
      debugBasketWarn(`[BasketPage] Cannot calculate accurate index delta for ${basket?.id} - missing basket creation snapshot`);
    }
  }

  if ((usesSettlementIndex || hasValidData) && positionEntryIndex !== null && positionEntryIndex > 0 && basket) {
    const stakeReturnRatio = displayedIndex / positionEntryIndex;
    stakeReturnPercent = (stakeReturnRatio - 1) * 100;

    if (isNaN(stakeReturnPercent) || !isFinite(stakeReturnPercent)) {
      console.error(`[BasketPage] Invalid stake return calculation for ${basket.id}:`, {
        displayedIndex,
        positionEntryIndex,
        stakeReturnPercent,
      });
      stakeReturnPercent = 0;
    }
  }

  const showStakeReturn = (usesSettlementIndex || hasValidData) && positionEntryIndex !== null && positionEntryIndex > 0;
  const headlineChange = showStakeReturn ? stakeReturnPercent : indexChangePercent;
  const headlineChangeBase = showStakeReturn ? displayedIndex - positionEntryIndex : indexChange;
  const headlineChangeLabel = showStakeReturn
    ? 'stake return'
    : creationReferenceSource === 'indexed_position'
      ? 'since first indexed position'
      : 'since creation';

  // Handle betting
  const handleBet = async () => {
    if (!manualBettingEnabled) {
      toast({
        title: 'Agent-Only Execution',
        description: 'Betting is available through your agent only.',
        variant: 'destructive',
      });
      return;
    }

    if (!varaEnabled) {
      toast({
        title: 'CHIP-Only Mode',
        description: 'Native VARA betting is disabled in this deployment.',
        variant: 'destructive',
      });
      return;
    }

    if (isFtAssetBasket) {
      toast({
        title: 'CHIP Basket',
        description: 'This basket accepts CHIP via the CHIP lane panel, not native VARA.',
        variant: 'destructive',
      });
      return;
    }

    // IMPORTANT: Check for null explicitly, not falsy (0 is a valid basket ID)
    if (!address || onChainId === null) {
      toast({
        title: 'Wallet Not Connected',
        description: 'Please connect your wallet to bet',
        variant: 'destructive',
      });
      return;
    }

    if (isVaraEth && !varaEthBasketMarket) {
      toast({
        title: 'Wallet Not Ready',
        description: 'Please ensure your MetaMask wallet is connected',
        variant: 'destructive',
      });
      return;
    }

    if (!isVaraEth && (!account || !program)) {
      toast({
        title: 'Wallet Not Connected',
        description: 'Please connect your wallet to bet',
        variant: 'destructive',
      });
      return;
    }

    const amount = parseFloat(betAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a valid bet amount',
        variant: 'destructive',
      });
      return;
    }

    if (!basket || basket.status !== 'Active') {
      toast({
        title: 'Basket Not Active',
        description: 'This basket is not accepting bets',
        variant: 'destructive',
      });
      return;
    }

    setBetting(true);
    setError(null);

    try {
      // Calculate index at creation in basis points (0-10000)
      // Use current live index if available, otherwise use snapshot index, or fallback to 5000 (50%)
      let indexAtCreationBps: number;
      if (hasValidData && liveIndex > 0) {
        // Convert live index (0-1.0) to basis points (0-10000)
        indexAtCreationBps = Math.max(1, Math.min(10000, Math.round(liveIndex * 10000)));
        console.log(`[BasketPage] Using live index for bet: ${liveIndex} (${indexAtCreationBps} bps)`);
      } else if (creationSnapshotIndex !== null && creationSnapshotIndex > 0) {
        // Fallback to snapshot index
        indexAtCreationBps = Math.max(1, Math.min(10000, Math.round(creationSnapshotIndex * 10000)));
        console.log(`[BasketPage] Using basket creation snapshot for bet fallback: ${creationSnapshotIndex} (${indexAtCreationBps} bps)`);
      } else {
        // Final fallback: 50% (5000 basis points) - this should rarely happen
        indexAtCreationBps = 5000;
        console.warn(`[BasketPage] No valid index data, using default 50% (5000 bps) for bet`);
      }

      if (isVaraEth) {
        // Vara.eth network
        if (!varaEthBasketMarket) {
          throw new Error('Vara.eth basket market client not available');
        }
        
        const value = toWVara(amount);
        await varaEthBasketMarket.betOnBasket(BigInt(onChainId), value, indexAtCreationBps);
        
        toast({
          title: 'Bet Placed!',
          description: `Successfully bet ${amount} wVARA on this basket at index ${(indexAtCreationBps / 100).toFixed(2)}%`,
        });
      } else {
        // Vara Network
        const value = toVara(amount);
        const tx = program.basketMarket
          .betOnBasket(onChainId, indexAtCreationBps)
          .withAccount(account.address, { signer: (account as any).signer })
          .withValue(value);
        
        await tx.calculateGas();
        const { response } = await tx.signAndSend();
        const res = await response();

        if (res && typeof res === 'object' && 'err' in res) {
          throw new Error(res.err);
        }

        toast({
          title: 'Bet Placed!',
          description: `Successfully bet ${amount} TVARA on this basket at index ${(indexAtCreationBps / 100).toFixed(2)}%`,
        });
      }

      setBetAmount('');
      // Refresh data after 2 seconds
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to place bet';
      setError(message);
      toast({
        title: 'Bet Failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setBetting(false);
    }
  };

  // Handle claiming
  const handleClaim = async () => {
    if (!varaEnabled) {
      toast({
        title: 'CHIP-Only Mode',
        description: 'Native VARA claim flow is disabled in this deployment.',
        variant: 'destructive',
      });
      return;
    }

    if (isFtAssetBasket) {
      toast({
        title: 'CHIP Basket',
        description: 'Claim CHIP payouts from the CHIP lane panel.',
        variant: 'destructive',
      });
      return;
    }

    // IMPORTANT: Check for null explicitly, not falsy (0 is a valid basket ID)
    if (!address || onChainId === null || !userPosition || !settlement) {
      toast({
        title: 'Cannot Claim',
        description: 'Nothing to claim',
        variant: 'destructive',
      });
      return;
    }

    if (isVaraEth && !varaEthBasketMarket) {
      toast({
        title: 'Wallet Not Ready',
        description: 'Please ensure your MetaMask wallet is connected',
        variant: 'destructive',
      });
      return;
    }

    if (!isVaraEth && (!account || !program)) {
      toast({
        title: 'Cannot Claim',
        description: 'Nothing to claim',
        variant: 'destructive',
      });
      return;
    }

    // Normalize settlement status for comparison
    const settlementStatus = typeof settlement.status === 'object' && settlement.status !== null
      ? Object.keys(settlement.status)[0]
      : settlement.status;
    
    if (settlementStatus !== 'Finalized') {
      toast({
        title: 'Settlement Not Finalized',
        description: 'Settlement must be finalized before claiming',
        variant: 'destructive',
      });
      return;
    }

    if (userPosition.claimed) {
      toast({
        title: 'Already Claimed',
        description: 'You have already claimed your payout',
        variant: 'destructive',
      });
      return;
    }

    // Calculate expected payout before claiming
    const expectedPayoutValue = calculatePayout(settlement, userPosition);
    const expectedPayoutNum = parseFloat(expectedPayoutValue);
    
    if (expectedPayoutNum <= 0) {
      toast({
        title: 'No Payout Available',
        description: 'Your payout amount is 0. You cannot claim zero funds.',
        variant: 'destructive',
      });
      return;
    }

    setClaiming(true);
    setError(null);

    try {
      let payout: bigint;
      let txHash: string | null = null;
      
      if (isVaraEth) {
        // Vara.eth network
        if (!varaEthBasketMarket) {
          throw new Error('Vara.eth basket market client not available');
        }
        
        console.log(`[handleClaim] Claiming for basket ${onChainId} on Vara.eth...`);
        payout = await varaEthBasketMarket.claim(BigInt(onChainId));
        const payoutFormatted = payout > 0n ? fromWVara(payout) : '0';
        
        if (payout === 0n) {
          throw new Error('Claim returned 0 payout. This should not happen if payout > 0.');
        }
        
        console.log(`[handleClaim] ✓ Successfully claimed ${payoutFormatted} wVARA (${payout.toString()} raw)`);
        
        // Show celebration modal instead of toast
        setClaimedPayoutAmount(payoutFormatted);
        setClaimedTxHash(undefined);
        setShowPayoutCelebration(true);
      } else {
        // Vara Network
        console.log(`[handleClaim] Claiming for basket ${onChainId} on Vara Network...`);
        const tx = program.basketMarket
          .claim(onChainId)
          .withAccount(account.address, { signer: (account as any).signer });
        
        await tx.calculateGas();
        const { txHash: sentTxHash, response } = await tx.signAndSend();
        txHash = sentTxHash || null;
        
        console.log(`[handleClaim] Transaction sent, hash: ${txHash}`);
        console.log(`[handleClaim] Waiting for response...`);

        // Wait for the response - this contains the actual result from the contract
        const txResult = await response();
        
        console.log(`[handleClaim] Transaction response received:`, txResult);

        // Check for errors in the response
        if (!txResult) {
          throw new Error('No response from transaction. The claim may have failed.');
        }

        if (typeof txResult === 'object' && 'err' in txResult) {
          const errorMsg = txResult.err;
          console.error(`[handleClaim] Claim failed with error:`, errorMsg);
          
          // Check for specific error messages
          if (errorMsg.includes('No payout available') || errorMsg.includes('payout') && errorMsg.includes('0')) {
            throw new Error('Payout amount is 0. There are no funds to claim.');
          }
          if (errorMsg.includes('Already claimed')) {
            throw new Error('You have already claimed this payout.');
          }
          if (errorMsg.includes('Failed to send payout')) {
            throw new Error('Transaction succeeded but failed to transfer funds. The program may not have sufficient balance. Contact support.');
          }
          
          throw new Error(errorMsg);
        }

        // Extract payout amount from response
        let payoutNum = 0;
        if (typeof txResult === 'object' && 'ok' in txResult) {
          payoutNum = Number(txResult.ok);
        } else if (typeof txResult === 'number' || typeof txResult === 'string' || typeof txResult === 'bigint') {
          payoutNum = Number(txResult);
        } else {
          console.warn(`[handleClaim] Unexpected response format:`, txResult);
        }
        
        payout = BigInt(payoutNum);
        const payoutFormatted = payout > 0n ? fromVara(payout) : '0';

        if (payout === 0n) {
          console.error(`[handleClaim] ⚠️ Claim returned 0 payout! Expected: ${expectedPayoutValue}`);
          console.error(`[handleClaim] Response was:`, txResult);
          throw new Error(`Claim returned 0 payout. Expected ${expectedPayoutValue} VARA. The contract may have rejected the claim or there was an issue with the payout calculation.`);
        }

        console.log(`[handleClaim] ✓ Successfully claimed ${payoutFormatted} VARA (${payout.toString()} raw). TX: ${txHash}`);
        console.log(`[handleClaim] ⚠️ IMPORTANT: Verify funds were received in your wallet. If not, check:`);
        console.log(`  - Program balance should decrease by ${payoutFormatted} VARA`);
        console.log(`  - Your wallet balance should increase by ${payoutFormatted} VARA`);
        console.log(`  - Transaction hash: ${txHash}`);
        
        // Show celebration modal instead of toast
        setClaimedPayoutAmount(payoutFormatted);
        setClaimedTxHash(txHash || undefined);
        setShowPayoutCelebration(true);
      }

      // Don't auto-reload - let user close the modal first
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to claim';
      setError(message);
      toast({
        title: 'Claim Failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setClaiming(false);
    }
  };

  // Show loading while:
  // 1. loadingOnChain is true
  // 2. API is not ready yet for Vara Network
  // 3. VaraEth market is still loading
  const isWaitingForConnection = isOnChain && (
    loadingOnChain || 
    (!isVaraEth && !isApiReady) || 
    (isVaraEth && isLoadingVaraEth)
  );

  if (isWaitingForConnection && !basket) {
    return (
      <div className="content-grid py-8">
        <div className="text-center py-16">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <h1 className="text-2xl font-semibold mb-2">Loading Basket...</h1>
          <p className="text-muted-foreground">
            {!isApiReady && !isVaraEth ? 'Connecting to Vara Network...' : 
             isLoadingVaraEth ? 'Connecting to Vara.eth...' : 
             'Fetching data from blockchain'}
          </p>
        </div>
      </div>
    );
  }

  if (!basket) {
    return (
      <div className="content-grid py-8">
        <div className="text-center py-16">
          <h1 className="text-2xl font-semibold mb-2">Basket Not Found</h1>
          <div className="text-muted-foreground mb-6">
            <p>{error || "This basket doesn't exist or has been removed."}</p>
            {isOnChain && onChainId !== null && (
              <div className="mt-4 space-y-2 text-sm">
                <div>Basket ID: onchain-{onChainId}</div>
                <div>Program ID: {ENV.PROGRAM_ID?.slice(0, 20)}...</div>
                <div>Network: {network}</div>
                <div>API Ready: {isApiReady ? 'Yes' : 'No'}</div>
                <div>Program Instance: {program ? 'Created' : 'Not created'}</div>
                {error && (
                  <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded text-left text-xs font-mono break-all">
                    Error: {error}
                  </div>
                )}
              </div>
            )}
          </div>
          {loadingOnChain && (
            <div className="mb-4">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-2">Loading basket from blockchain...</p>
            </div>
          )}
          {!loadingOnChain && isOnChain && (
            <div className="mt-4 p-4 bg-muted rounded text-left text-xs">
              <div className="font-semibold mb-2">Debug Info:</div>
              <div>• Check browser console for detailed logs</div>
              <div>• Look for logs starting with [BasketPage]</div>
              <div>• Verify the basket exists on the program</div>
              <div>• Check if program ID matches: {ENV.PROGRAM_ID?.slice(0, 20)}...</div>
            </div>
          )}
          <div className="mt-6">
            <Link to="/">
              <Button>Back to Explore</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const networkConfig = NETWORKS[basket?.network || 'vara'];
  const canBet = isOnChain && basket?.status === 'Active' && canUseNativeVaraFlow;
  
  // Can claim only if: on-chain, finalized, has position, not claimed, AND payout > 0
  // Allow claiming even if payout is 0 (user lost money, but needs to finalize position)
  // Allow claiming even if payout is 0 (user lost money, but needs to finalize position)
  // The contract allows claiming 0 payouts to mark position as claimed
  const canClaim = isOnChain && 
                   canUseNativeVaraFlow &&
                   settlementStatus === 'Finalized' && 
                   userPosition && 
                   !userPosition.claimed;
                   // Note: Removed expectedPayoutNum > 0 check - users can claim 0 payouts (losses)

  const handleFollow = async () => {
    if (!address) {
      await connect();
      return;
    }

    if (following) {
      unfollowBasket(address, basket.id);
      toast({ title: 'Unfollowed basket' });
    } else {
      followBasket(address, basket.id);
      toast({ title: 'Following basket!' });
    }
  };

  const handleClone = async () => {
    if (!basket || basket.items.length === 0) {
      toast({
        title: 'Nothing To Clone',
        description: 'This basket does not contain any items yet.',
        variant: 'destructive',
      });
      return;
    }

    setCloningBasket(true);

    try {
      const marketIds = Array.from(new Set(basket.items.map((item) => item.marketId)));
      const marketMap = await getMarketDetailsBatch(marketIds);

      const cloneableItems = basket.items.flatMap((item) => {
        const market = marketMap.get(item.marketId);
        if (!market || !isCloneableMarket(market)) {
          return [];
        }

        const probs = getOutcomeProbabilities(market);
        return [{
          ...item,
          slug: market.slug || item.slug,
          question: market.question || item.question,
          currentProb: item.outcome === 'YES' ? probs.YES : probs.NO,
        }];
      });

      const skippedCount = basket.items.length - cloneableItems.length;

      if (cloneableItems.length === 0) {
        toast({
          title: 'Clone Unavailable',
          description: 'All markets in this basket have already ended or stopped accepting orders.',
          variant: 'destructive',
        });
        return;
      }

      replaceDraft({
        items: cloneableItems,
        name: basket.name,
        description: basket.description,
        tags: basket.tags,
      });

      toast({
        title: skippedCount > 0 ? 'Basket cloned with active markets only' : 'Basket cloned to builder',
        description:
          skippedCount > 0
            ? `${skippedCount} item${skippedCount === 1 ? '' : 's'} were skipped because the market already ended or is no longer accepting orders.`
            : 'Edit the weights and save as your own.',
      });
      navigate('/builder');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to clone this basket.';
      toast({
        title: 'Clone Failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setCloningBasket(false);
    }
  };

  const handleDelete = () => {
    if (!basket || !id) return;
    
    if (isOnChain) {
      toast({
        title: 'Cannot Delete On-Chain Basket',
        description: 'This basket exists on the blockchain and cannot be deleted from the frontend. It will remain on-chain permanently.',
        variant: 'destructive',
      });
      return;
    }
    
    if (window.confirm(`Are you sure you want to delete "${basket.name}"?\n\nThis will only remove it from your local view. If it's on-chain, it will still exist on the blockchain.`)) {
      const deleted = deleteBasket(id);
      if (deleted) {
        toast({
          title: 'Basket Deleted',
          description: `"${basket.name}" has been removed.`,
        });
        navigate('/me');
      } else {
        toast({
          title: 'Delete Failed',
          description: 'Could not delete the basket.',
          variant: 'destructive',
        });
      }
    }
  };

  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Link copied!' });
  };

  const handleShare = () => {
    const text = `Check out this prediction basket: "${basket.name}" - Index: ${liveIndex.toFixed(3)}`;
    navigator.clipboard.writeText(text);
    toast({ title: 'Share text copied!' });
  };

  return (
    <div className="content-grid py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold">{basket.name}</h1>
            <div className="flex items-center gap-1.5">
              {basket.network === 'vara' ? (
                <img src="/toggle.png" alt="Vara Network" className="w-4 h-4 object-contain" />
              ) : (
                <Circle className="w-2 h-2 fill-blue-500 text-blue-500" />
              )}
              <span className="text-sm text-muted-foreground">{networkConfig.name}</span>
            </div>
            {isOnChain && (
              <Badge variant="secondary" className="ml-2">
                On-Chain
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>by {truncateAddress(basket.owner)}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!isBasketSupportedInUi && (
        <Alert className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This deployment runs in CHIP-only mode. Native VARA basket actions are hidden for this basket.
          </AlertDescription>
        </Alert>
      )}

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-8">
        {/* Left: Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Index Card */}
          <Card className="card-elevated">
            <CardContent className="py-6">
              <div className="flex items-baseline gap-4 mb-4">
                <span className="index-display">
                  {displayedIndex.toFixed(3)}
                </span>
                {(usesSettlementIndex || hasValidData) && (showStakeReturn || creationSnapshotIndex !== null) ? (
                  <span className={`stat-chip ${getChangeClass(headlineChangeBase)}`}>
                    {showStakeReturn
                      ? `${headlineChange >= 0 ? '+' : ''}${headlineChange.toFixed(2)}% ${headlineChangeLabel}`
                      : `${headlineChange >= 0 ? '+' : ''}${headlineChange.toFixed(2)}% ${headlineChangeLabel}`}
                  </span>
                ) : creationSnapshotIndex === null ? (
                  <span className="stat-chip stat-chip-neutral">
                    Creation reference unavailable
                  </span>
                ) : (
                  <span className="stat-chip stat-chip-neutral">
                    Loading...
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  {basket.items.length} items
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  {followers} followers
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  Created {new Date(basket.createdAt).toLocaleDateString()}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Settlement Status (on-chain only) */}
          {isOnChain && (
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base">Settlement Status</CardTitle>
              </CardHeader>
              <CardContent>
                {settlement ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <Badge variant={
                        settlementStatus === 'Finalized' ? 'default' :
                        settlementStatus === 'Proposed' ? 'secondary' : 'destructive'
                      }>
                        {settlementStatus || 'Unknown'}
                      </Badge>
                    </div>
                    {settlementStatus === 'Proposed' && (
                      <div className="text-sm text-muted-foreground">
                        Challenge deadline: {new Date(Number(settlement.challenge_deadline) * 1000).toLocaleString()}
                      </div>
                    )}
                    {settlementStatus === 'Finalized' && settlement.finalized_at && (
                      <div className="text-sm text-muted-foreground">
                        Finalized: {new Date(Number(settlement.finalized_at) * 1000).toLocaleString()}
                      </div>
                    )}
                    <div className="text-sm">
                      <span className="text-muted-foreground">Payout per share: </span>
                      <span className="font-medium">{(Number(settlement.payout_per_share) / 10000 * 100).toFixed(2)}%</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Settlement has not been proposed yet. Claiming becomes available only after a settlement is proposed and the challenge window has ended.
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Description & Tags */}
          {(basket.description || basket.tags.length > 0) && (
            <Card className="card-elevated">
              <CardContent className="py-5">
                {basket.description && (
                  <p className="text-muted-foreground mb-3">{basket.description}</p>
                )}
                {basket.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {basket.tags.map(tag => (
                      <Badge key={tag} variant="secondary">{tag}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Items Table */}
          <Card className="card-elevated">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">Basket Items</CardTitle>
                  {isBasketItemsRefreshing && !usesSettlementIndex && (
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Updating
                    </span>
                  )}
                </div>
                {deferredBasketItemRows.length > 0 && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {basketStatusSummary.resolvedCount > 0 && (
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400" />
                        {basketStatusSummary.resolvedCount} resolved
                      </span>
                    )}
                    {basketStatusSummary.closedUnresolvedCount > 0 && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-yellow-600 dark:text-yellow-400" />
                        {basketStatusSummary.closedUnresolvedCount} closed
                      </span>
                    )}
                    {basketStatusSummary.openCount > 0 && (
                      <span className="flex items-center gap-1">
                        <Circle className="w-3 h-3 text-blue-600 dark:text-blue-400 fill-current" />
                        {basketStatusSummary.openCount} open
                      </span>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
                <div className={`border rounded-lg divide-y transition-opacity ${isBasketItemsRefreshing ? 'opacity-80' : 'opacity-100'}`}>
                  <div className="grid grid-cols-9 gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground bg-muted/50">
                    <span className="col-span-2">Market</span>
                    <span className="text-center">Position</span>
                    <span className="text-right">Status</span>
                    <span className="text-right">Weight</span>
                    <span className="text-right">{hasFinalItemResolutions ? 'Price (Final)' : 'Price (Live)'}</span>
                    <span className="text-right">{hasFinalItemResolutions ? 'Prob (Final)' : 'Prob (Live)'}</span>
                    <span className="text-right">Original</span>
                    <span className="text-right">Change</span>
                  </div>
                {deferredBasketItemRows.map((row) => {
                  return (
                    <div 
                      key={row.key}
                      className="grid grid-cols-9 gap-2 px-4 py-3 items-center hover:bg-muted/30 transition-colors group"
                    >
                      <div className="col-span-2 flex items-center gap-2 min-w-0">
                        <span className="text-sm break-words flex-1" title={row.item.question}>
                          {row.item.question}
                        </span>
                        {row.polymarketUrl && (
                          <a
                            href={row.polymarketUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Verify on Polymarket"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                          </a>
                        )}
                      </div>
                      <span className="text-center">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                          row.item.outcome === 'YES' 
                            ? 'bg-accent/10 text-accent' 
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {row.item.outcome}
                        </span>
                      </span>
                      <span className="text-right">
                        {row.marketStatus ? (
                          <div className="flex flex-col items-end gap-0.5">
                            {row.isResolved ? (
                              <Badge 
                                variant={row.resolvedOutcome === row.item.outcome ? "default" : "secondary"}
                                className="text-[10px] px-1.5 py-0"
                              >
                                <CheckCircle className="w-2.5 h-2.5 mr-0.5" />
                                {row.resolvedOutcome}
                              </Badge>
                            ) : row.isClosed ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                <Clock className="w-2.5 h-2.5 mr-0.5" />
                                Closed
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                                <Circle className="w-2 h-2 mr-0.5 fill-current" />
                                Open
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </span>
                      <span className="text-right text-sm tabular-nums" title={`Weight: ${(row.item.weightBps / 100).toFixed(2)}%`}>
                        {formatWeight(row.item.weightBps)}
                      </span>
                      <span 
                        className="text-right text-sm tabular-nums font-medium" 
                        title={row.price !== null ? `Live price from Polymarket: $${row.price.toFixed(4)}` : 'Price not available'}
                      >
                        {row.price !== null ? formatPrice(row.price) : '-'}
                      </span>
                      <span 
                        className="text-right text-sm tabular-nums font-medium"
                        title={row.currentProb !== null ? `Current probability: ${(row.currentProb * 100).toFixed(2)}% (from Polymarket)` : 'Live probability unavailable'}
                      >
                        {row.currentProb !== null ? formatProbability(row.currentProb) : '-'}
                      </span>
                      <span 
                        className="text-right text-sm tabular-nums text-muted-foreground"
                        title={row.change ? `Original probability at creation: ${(row.change.originalProb * 100).toFixed(2)}%` : 'Original data not available'}
                      >
                        {row.change ? formatProbability(row.change.originalProb) : '-'}
                      </span>
                      <span className="text-right text-sm tabular-nums">
                        {row.change ? (
                          <div 
                            className="flex flex-col items-end cursor-help"
                          >
                            <span className={`font-medium ${
                              row.isPositive
                                ? 'text-green-600 dark:text-green-400' 
                                : 'text-red-600 dark:text-red-400'
                            }`}>
                              {row.isPositive ? '+' : ''}{(row.change.change * 100).toFixed(1)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              
            </CardContent>
          </Card>

          {/* Basket Index Calculation Breakdown */}
          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calculator className="w-4 h-4" />
                Index Calculation
              </CardTitle>
              <CardDescription>
                How the basket index is calculated from individual market probabilities
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Current Index */}
                <div className="grid grid-cols-2 gap-4 p-3 bg-muted/30 rounded-lg">
                  <div>
                    <span className="text-xs text-muted-foreground">{displayedIndexLabel}</span>
                    <p className="text-2xl font-semibold tabular-nums mt-1">
                      {displayedIndex.toFixed(3)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {displayedIndexDescription}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">{creationReferenceLabel}</span>
                    <p className="text-2xl font-semibold tabular-nums mt-1">
                      {creationSnapshotIndex !== null ? creationSnapshotIndex.toFixed(3) : '—'}
                    </p>
                    {creationSnapshotIndex !== null ? (
                      <p className="text-[10px] text-muted-foreground">
                        {creationReferenceDescription}
                      </p>
                    ) : (
                      <p className="text-[10px] text-yellow-500">
                        Not stored on-chain and no indexed position reference is available for this basket.
                      </p>
                    )}
                  </div>
                </div>

                {positionEntryIndex !== null && (
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <div className="text-xs text-muted-foreground">Your Entry Index ({entryIndexSource})</div>
                    <div className="text-lg font-semibold tabular-nums mt-1">
                      {positionEntryIndex.toFixed(3)}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {entryIndexBps} bps. This value is used for payout, not for basket "since creation" stats.
                    </div>
                  </div>
                )}


                {/* Breakdown by Item */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium">Calculation Breakdown:</div>
                  {usesSettlementIndex && (
                    <div className="text-[10px] text-muted-foreground">
                      Settlement is finalized. Headline and item rows now use on-chain settlement data when item resolutions are available.
                    </div>
                  )}
                  <div className="space-y-1 text-xs">
                    {deferredBasketItemRows.map((row) => {
                      return (
                        <div 
                          key={row.key}
                          className="flex items-center justify-between p-2 bg-muted/20 rounded text-xs"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-medium">{row.item.slug || row.item.question}</div>
                            <div className="text-muted-foreground mt-0.5">
                              {row.item.outcome} • {(row.item.weightBps / 100).toFixed(1)}% weight
                            </div>
                          </div>
                          <div className="text-right tabular-nums ml-2">
                            <div className="font-medium">
                              {row.currentProb !== null
                                ? `${(row.item.weightBps / 100).toFixed(1)}% × ${(row.currentProb * 100).toFixed(1)}% = ${((row.contribution ?? 0) * 100).toFixed(2)}%`
                                : 'Live probability unavailable'}
                            </div>
                            {row.change && Math.abs(row.probChange) > 0.001 && (
                              <div className={`text-[10px] mt-0.5 ${row.probChange > 0 ? 'text-green-500' : row.probChange < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                                Prob: {(row.change.originalProb * 100).toFixed(1)}% → {(row.change.currentProb * 100).toFixed(1)}% ({row.probChange >= 0 ? '+' : ''}{(row.probChange * 100).toFixed(1)}%)
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="pt-2 mt-2 border-t font-mono text-xs">
                    <div className="flex justify-between">
                      <span>{usesSettlementIndex ? 'Final settlement total:' : 'Total:'}</span>
                      <span className="font-semibold">{displayedIndex.toFixed(3)}</span>
                    </div>
                  </div>
                </div>

              </div>
            </CardContent>
          </Card>

          {/* Snapshot */}
          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Reference Indices</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`grid gap-4 text-sm ${positionEntryIndex !== null ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div>
                  <span className="text-muted-foreground">{creationReferenceLabel}</span>
                  <p className="text-xl font-semibold tabular-nums mt-1">
                    {creationSnapshotIndex !== null ? creationSnapshotIndex.toFixed(3) : '—'}
                  </p>
                  {creationSnapshotIndex !== null ? (
                    <p className="text-[10px] text-muted-foreground">
                      {creationReferenceDescription}
                    </p>
                  ) : (
                    <p className="text-[10px] text-yellow-500">
                      No local snapshot or indexed position reference is available for this basket.
                    </p>
                  )}
                </div>
                {positionEntryIndex !== null && (
                  <div>
                    <span className="text-muted-foreground">Your entry index</span>
                    <p className="text-xl font-semibold tabular-nums mt-1">
                      {positionEntryIndex.toFixed(3)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {entryIndexBps} bps from {entryIndexSource}
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Timestamp</span>
                  <p className="text-sm mt-1">
                    {creationReferenceTimestamp
                      ? new Date(creationReferenceTimestamp).toLocaleString()
                      : 'Unavailable'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Actions */}
        <div className="space-y-4">
          {/* Betting UI (on-chain only) */}
          {isOnChain && canBet && (
            manualBettingEnabled ? (
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base">Bet on Basket</CardTitle>
                <CardDescription>
                  {userPosition && (
                    <span className="text-sm">
                      Your shares: {isVaraEth 
                        ? fromWVara(BigInt(String(userPosition.shares)))
                        : fromVara(BigInt(String(userPosition.shares)))}
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  type="number"
                  placeholder={`Amount (${isVaraEth ? 'wVARA' : 'TVARA'})`}
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  min="0"
                  step={isVaraEth ? "0.0001" : "0.01"}
                />
                <Button
                  onClick={handleBet}
                  disabled={betting || !betAmount || parseFloat(betAmount) <= 0}
                  className="w-full gap-2"
                  size="lg"
                >
                  {betting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Placing Bet...
                    </>
                  ) : (
                    <>
                      <Coins className="w-4 h-4" />
                      Place Bet
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
            ) : (
              <AgentTradingNotice description="Native-asset betting is available through your agent only." />
            )
          )}

          {isOnChain && isFtAssetBasket && (
            <BetLanePanel
              basketId={onChainId}
              basketStatus={basket?.status}
              settlement={settlement}
            />
          )}

          {/* Debug Info Card - Shows why claim button isn't visible */}
          {isOnChain && canUseNativeVaraFlow && settlement && userPosition && (
            <Card className="card-elevated border-border/50 bg-muted/30">
              <CardHeader>
                <CardTitle className="text-sm">Payout Calculation Debug</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Your Shares:</span>
                  <span className="font-mono">{fromVara(BigInt(String(userPosition.shares)))} {isVaraEth ? 'wVARA' : 'TVARA'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payout per Share:</span>
                  <span className="font-mono">{Number(settlement.payout_per_share)} / 10000</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Basket Index:</span>
                  <span className="font-mono">{(Number(settlement.payout_per_share) / 10000).toFixed(4)} ({(Number(settlement.payout_per_share) / 10000 * 100).toFixed(2)}%)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Calculated Payout:</span>
                  <span className="font-mono font-semibold">{expectedPayout || '0'} {isVaraEth ? 'wVARA' : 'TVARA'}</span>
                </div>
                {expectedPayoutNum > 0 && parseFloat(fromVara(BigInt(String(userPosition.shares)))) > 0 && (
                  <div className="pt-2 mt-2 border-t">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Return Ratio:</span>
                      <span className={expectedPayoutNum >= parseFloat(fromVara(BigInt(String(userPosition.shares)))) ? 'text-green-500' : 'text-red-500'}>
                        {(expectedPayoutNum / parseFloat(fromVara(BigInt(String(userPosition.shares)))) * 100).toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-muted-foreground">Profit/Loss:</span>
                      <span className={expectedPayoutNum >= parseFloat(fromVara(BigInt(String(userPosition.shares)))) ? 'text-green-500' : 'text-red-500'}>
                        {expectedPayoutNum >= parseFloat(fromVara(BigInt(String(userPosition.shares)))) 
                          ? `+${(expectedPayoutNum - parseFloat(fromVara(BigInt(String(userPosition.shares))))).toFixed(4)}`
                          : `${(expectedPayoutNum - parseFloat(fromVara(BigInt(String(userPosition.shares))))).toFixed(4)}`
                        } {isVaraEth ? 'wVARA' : 'TVARA'}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Claim UI (on-chain only) - ALWAYS SHOW WHEN ON-CHAIN */}
          {isOnChain && canUseNativeVaraFlow && (
            <Card className={`card-elevated ${manualBettingEnabled && canClaim ? 'border-accent' : 'border-border/50'}`}>
              <CardHeader>
                <CardTitle className="text-base">Claim Payout</CardTitle>
                <CardDescription>
                  {manualBettingEnabled
                    ? canClaim 
                    ? expectedPayoutNum > 0
                      ? `Settlement is finalized. Claim your winnings (${expectedPayout} ${isVaraEth ? 'wVARA' : 'TVARA'}).`
                      : `Settlement is finalized. Finalize your position (you lost ${fromVara(BigInt(String(userPosition.shares)))} ${isVaraEth ? 'wVARA' : 'TVARA'}).`
                    : !settlement 
                      ? 'Settlement has not been proposed yet. Claiming becomes available only after a settlement is proposed and the challenge window has ended.'
                      : settlementStatus !== 'Finalized'
                        ? `Settlement status: ${settlementStatus || 'Unknown'}. ${settlementStatus === 'Proposed'
                            ? `Waiting for the challenge window${challengeWindowLabel ? ` (${challengeWindowLabel})` : ''} to end before claiming.`
                            : 'Settlement must be finalized before claiming.'}`
                        : !userPosition
                          ? address 
                            ? 'You don\'t have a position in this basket. You need to place a bet to participate. Creating a basket does not automatically give you a position.'
                            : 'Connect your wallet to check if you have a position in this basket.'
                          : userPosition.claimed
                          ? 'You have already claimed your payout for this basket.'
                            : expectedPayoutNum <= 0
                              ? `Your payout amount is 0 ${isVaraEth ? 'wVARA' : 'TVARA'}. You can still claim to finalize your position (you lost ${fromVara(BigInt(String(userPosition.shares)))} ${isVaraEth ? 'wVARA' : 'TVARA'}).`
                              : 'Unable to claim. Check debug info below.'
                    : 'Payout claiming is available through your agent only.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Show this section even if userPosition is null to show why they can't claim */}
                {expectedPayout !== null && canClaim && settlement && userPosition && (
                  <div className="p-3 bg-muted/30 rounded-lg border space-y-2">
                    <div className="text-sm flex items-baseline gap-2 flex-wrap">
                      <span className="text-muted-foreground">Expected payout:</span>
                      <span className={`font-semibold text-lg whitespace-nowrap ${expectedPayoutNum > 0 ? '' : 'text-muted-foreground'}`}>
                        {expectedPayout} {isVaraEth ? 'wVARA' : 'TVARA'}
                      </span>
                    </div>
                    
                    {/* Profit/Loss Display - Prominent */}
                    {userPosition && (() => {
                      const betAmount = parseFloat(fromVara(BigInt(String(userPosition.shares))));
                      const profitLoss = expectedPayoutNum - betAmount;
                      const profitLossPercent = betAmount > 0 ? ((profitLoss / betAmount) * 100) : 0;
                      
                      if (expectedPayoutNum === 0) {
                        return (
                          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-red-600 dark:text-red-400">Total Loss</span>
                              <span className="text-lg font-bold text-red-600 dark:text-red-400">
                                -{betAmount.toFixed(4)} {isVaraEth ? 'wVARA' : 'TVARA'}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              You lost 100% of your bet ({betAmount.toFixed(4)} {isVaraEth ? 'wVARA' : 'TVARA'})
                            </div>
                          </div>
                        );
                      } else if (profitLoss > 0) {
                        return (
                          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-green-600 dark:text-green-400">Profit</span>
                              <span className="text-lg font-bold text-green-600 dark:text-green-400">
                                +{profitLoss.toFixed(4)} {isVaraEth ? 'wVARA' : 'TVARA'}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {profitLossPercent.toFixed(2)}% return on your bet
                            </div>
                          </div>
                        );
                      } else if (profitLoss < 0) {
                        return (
                          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-red-600 dark:text-red-400">Loss</span>
                              <span className="text-lg font-bold text-red-600 dark:text-red-400">
                                {profitLoss.toFixed(4)} {isVaraEth ? 'wVARA' : 'TVARA'}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {Math.abs(profitLossPercent).toFixed(2)}% loss on your bet
                            </div>
                          </div>
                        );
                      } else {
                        return (
                          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-yellow-600 dark:text-yellow-400">Break Even</span>
                              <span className="text-lg font-bold text-yellow-600 dark:text-yellow-400">
                                0.0000 {isVaraEth ? 'wVARA' : 'TVARA'}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              You get back exactly what you bet
                            </div>
                          </div>
                        );
                      }
                    })()}
                    
                  </div>
                )}
                {manualBettingEnabled ? (
                  <Button
                    onClick={handleClaim}
                    disabled={!canClaim || claiming}
                    className="w-full gap-2"
                    size="lg"
                    variant={canClaim ? (expectedPayoutNum > 0 ? "default" : "destructive") : "secondary"}
                  >
                    {claiming ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {expectedPayoutNum > 0 ? 'Claiming...' : 'Finalizing...'}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        {expectedPayoutNum > 0 
                          ? `Claim Payout (${expectedPayout} ${isVaraEth ? 'wVARA' : 'TVARA'})`
                          : expectedPayoutNum === 0
                            ? 'Finalize Position'
                            : 'Claim Payout'
                        }
                      </>
                    )}
                  </Button>
                ) : (
                  <AgentTradingNotice description="Payout claiming is available through your agent only." />
                )}
                {!manualBettingEnabled ? null : !canClaim && (
                  <div className="text-xs text-muted-foreground pt-2 border-t">
                    <div className="font-semibold mb-1">Why can't I claim?</div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {!settlement && <li>No settlement exists yet</li>}
                      {settlement && settlementStatus !== 'Finalized' && <li>Settlement is {settlementStatus || 'not finalized'}</li>}
                      {!userPosition && address && (
                        <li className="text-yellow-500">
                          You don't have a position (no bet placed). Creating a basket does not automatically give you a position - you need to place a bet separately.
                        </li>
                      )}
                      {!userPosition && !address && (
                        <li className="text-yellow-500">Connect your wallet to check if you have a position</li>
                      )}
                      {userPosition && userPosition.claimed && <li>You already claimed</li>}
                      {expectedPayoutNum <= 0 && settlement && settlementStatus === 'Finalized' && userPosition && !userPosition.claimed && (
                        <li className="text-yellow-500">Payout amount is 0 (no funds to claim)</li>
                      )}
                    </ul>
                    {expectedPayout && (
                      <div className="mt-2 pt-2 border-t flex items-baseline gap-2 flex-wrap">
                        <span className="text-muted-foreground">Expected payout:</span>
                        <span className={`whitespace-nowrap ${expectedPayoutNum > 0 ? 'font-semibold' : 'text-yellow-500'}`}>
                          {expectedPayout} {isVaraEth ? 'wVARA' : 'TVARA'}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* User Position (on-chain only) */}
          {isOnChain && canUseNativeVaraFlow && userPosition && (
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base">Your Position</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shares:</span>
                    <span className="font-medium">
                      {isVaraEth 
                        ? fromWVara(BigInt(String(userPosition.shares)))
                        : fromVara(BigInt(String(userPosition.shares)))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Claimed:</span>
                    <Badge variant={userPosition.claimed ? 'default' : 'secondary'}>
                      {userPosition.claimed ? 'Yes' : 'No'}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Button 
            onClick={handleFollow}
            variant={following ? 'outline' : 'default'}
            className="w-full gap-2"
            size="lg"
          >
            <Heart className={`w-4 h-4 ${following ? 'fill-current' : ''}`} />
            {following ? 'Following' : 'Follow Basket'}
          </Button>

          <Button 
            onClick={handleClone}
            variant="outline"
            className="w-full gap-2"
            disabled={cloningBasket}
          >
            {cloningBasket ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Cloning Basket...
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Clone Basket
              </>
            )}
          </Button>

          {isOnChain ? (
            <div className="p-3 bg-muted/50 rounded-lg border border-dashed">
              <p className="text-xs text-muted-foreground text-center">
                This basket is stored on-chain and cannot be deleted. It will remain on the blockchain permanently.
              </p>
            </div>
          ) : (
            <Button 
              onClick={handleDelete}
              variant="destructive"
              className="w-full gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Basket
            </Button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button 
              onClick={handleCopyLink}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy Link'}
            </Button>
            <Button 
              onClick={handleShare}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share
            </Button>
          </div>
        </div>
      </div>

      {/* Payout Celebration Modal */}
      {basket && settlement && canUseNativeVaraFlow && (
        <PayoutCelebration
          isOpen={showPayoutCelebration}
          onClose={() => {
            setShowPayoutCelebration(false);
            // Only refresh if this was from a fresh claim (has payout amount set)
            if (claimedPayoutAmount !== '0' && claimedPayoutAmount !== expectedPayout) {
              setTimeout(() => window.location.reload(), 500);
            }
          }}
          payoutAmount={claimedPayoutAmount !== '0' ? claimedPayoutAmount : (expectedPayout || '0')}
          basketName={basket.name}
          basketId={onChainId ?? 0}
          markets={basket.items.map(item => ({
            question: item.question,
            slug: item.slug,
            marketId: item.marketId,
            outcome: item.outcome,
            weightBps: item.weightBps,
          }))}
          indexAtCreation={payoutReferenceIndex}
          settlementIndex={Number(settlement.payout_per_share) / 10000}
          currency={isVaraEth ? 'wVARA' : 'TVARA'}
          txHash={claimedTxHash}
        />
      )}

      {/* Floating Icon for Claimed Baskets - View Results */}
      {canUseNativeVaraFlow && userPosition?.claimed && (
        <button
          onClick={() => {
            setClaimedPayoutAmount(expectedPayout || '0');
            setClaimedTxHash(undefined);
            setShowPayoutCelebration(true);
          }}
          className="fixed bottom-6 right-6 z-[9999] w-12 h-12 rounded-full bg-[hsl(120,100%,50%)] flex items-center justify-center hover:scale-110 transition-all cursor-pointer shadow-lg"
          title="View payout results"
          style={{
            boxShadow: '0 0 25px hsl(120 100% 50% / 0.5)',
          }}
        >
          <Trophy className="w-5 h-5 text-black" />
        </button>
      )}
    </div>
  );
}
