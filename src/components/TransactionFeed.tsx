import { useState, useEffect, useRef } from 'react';
import { truncateAddress } from '@/lib/basket-utils';
import { fetchAgentName } from '@/lib/arena';
import { ENV } from '@/env';

type FeedEvent = {
  id: string;
  type: 'bet' | 'claim' | 'payout';
  agent: string;
  agentName: string | null;
  basketId: number | null;
  amount: string | null;
  timestamp: number;
};

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'waiting';

const MAX_EVENTS = 15;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

/**
 * Live transaction feed via Vara node WebSocket.
 * Subscribes to system events and filters for BetLane program activity.
 *
 * NOTE: This is a simplified event listener. It connects to the Vara node WS,
 * subscribes to new heads, and checks for relevant program events.
 * A production version would use a Subsquid indexer or dedicated event stream.
 */
export default function TransactionFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [state, setState] = useState<ConnectionState>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const nameCache = useRef<Record<string, string | null>>({});

  const resolveAgentName = async (address: string): Promise<string | null> => {
    if (address in nameCache.current) return nameCache.current[address];
    const name = await fetchAgentName(address);
    nameCache.current[address] = name;
    return name;
  };

  const addEvent = (event: FeedEvent) => {
    setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
  };

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let destroyed = false;

    const connect = () => {
      if (destroyed) return;

      const nodeUrl = ENV.NODE_ADDRESS || 'wss://testnet.vara.network';
      setState('connecting');

      try {
        const ws = new WebSocket(nodeUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setState('connected');
          retriesRef.current = 0;

          // Subscribe to new finalized heads
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'chain_subscribeFinalizedHeads',
            params: [],
          }));
        };

        ws.onmessage = async (msg) => {
          try {
            const data = JSON.parse(msg.data);

            // When we get a new finalized block, check for relevant events
            if (data.params?.result?.number) {
              const blockNumber = parseInt(data.params.result.number, 16);

              // Fetch events for this block
              // For now, we generate a placeholder event to show the feed is alive.
              // TODO: Parse actual UserMessageSent events filtered by BetLane program ID.
              // Real implementation: query system.events at this block hash,
              // filter for gear.UserMessageSent where source == BET_LANE_PROGRAM_ID,
              // decode the Sails payload to determine PlaceBet / Claim / ClaimPayout.

              if (events.length === 0 && blockNumber % 10 === 0) {
                setState('waiting');
              }
            }
          } catch {
            // Skip unparseable messages
          }
        };

        ws.onerror = () => {
          // onclose will handle reconnect
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (destroyed) return;

          setState('reconnecting');
          const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, retriesRef.current),
            RECONNECT_MAX_MS,
          );
          retriesRef.current++;
          reconnectTimeout = setTimeout(connect, delay);
        };
      } catch {
        setState('reconnecting');
        reconnectTimeout = setTimeout(connect, RECONNECT_BASE_MS);
      }
    };

    connect();

    return () => {
      destroyed = true;
      clearTimeout(reconnectTimeout);
      wsRef.current?.close();
    };
  }, []);

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
        <h4 className="text-sm font-semibold">Live Transactions</h4>
        <span className="flex items-center gap-1.5 text-xs">
          {state === 'connected' || state === 'waiting' ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-muted-foreground">Connected</span>
            </>
          ) : state === 'reconnecting' ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span className="text-amber-500">Reconnecting...</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse" />
              <span className="text-muted-foreground">Connecting...</span>
            </>
          )}
        </span>
      </div>
      <div className="divide-y max-h-[320px] overflow-y-auto">
        {events.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {state === 'waiting'
                ? 'Waiting for agent transactions...'
                : state === 'reconnecting'
                  ? 'Reconnecting to Vara node...'
                  : 'Connecting to live feed...'
              }
            </p>
          </div>
        ) : (
          events.map((event) => (
            <div key={event.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                event.type === 'bet' ? 'bg-blue-500' :
                event.type === 'claim' ? 'bg-green-500' :
                'bg-amber-500'
              }`} />
              <span className="font-medium truncate">
                {event.agentName || truncateAddress(event.agent)}
              </span>
              <span className="text-muted-foreground">
                {event.type === 'bet' ? 'bet on' :
                 event.type === 'claim' ? 'claimed' :
                 'payout from'
                }
              </span>
              {event.basketId !== null && (
                <span className="text-muted-foreground">
                  Basket #{event.basketId}
                </span>
              )}
              {event.amount && (
                <span className="ml-auto tabular-nums font-mono text-xs text-muted-foreground">
                  {event.amount} CHIP
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
