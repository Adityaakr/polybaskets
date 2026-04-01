import { useState, useEffect, useCallback, useRef } from 'react';

const COINGECKO_IDS: Record<string, string> = {
  bitcoin: 'bitcoin',
  btc: 'bitcoin',
  ethereum: 'ethereum',
  eth: 'ethereum',
  solana: 'solana',
  sol: 'solana',
  dogecoin: 'dogecoin',
  doge: 'dogecoin',
  xrp: 'ripple',
  ripple: 'ripple',
  bnb: 'binancecoin',
  binance: 'binancecoin',
  cardano: 'cardano',
  ada: 'cardano',
  polygon: 'matic-network',
  matic: 'matic-network',
  avalanche: 'avalanche-2',
  avax: 'avalanche-2',
  polkadot: 'polkadot',
  dot: 'polkadot',
  litecoin: 'litecoin',
  ltc: 'litecoin',
  chainlink: 'chainlink',
  link: 'chainlink',
};

const priceCache: Record<string, number> = {};
const POLL_MS = 10_000;
let lastFetch = 0;
let fetchPromise: Promise<void> | null = null;

async function fetchAllPrices(): Promise<void> {
  const now = Date.now();
  if (now - lastFetch < POLL_MS - 500) return;
  lastFetch = now;

  const ids = [...new Set(Object.values(COINGECKO_IDS).filter(Boolean))].join(',');
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&precision=full`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return;
    const data = await res.json();
    for (const [id, val] of Object.entries(data)) {
      const usd = (val as any)?.usd;
      if (typeof usd === 'number') priceCache[id] = usd;
    }
  } catch { /* best-effort */ }
}

function ensureFresh(): Promise<void> {
  if (!fetchPromise) {
    fetchPromise = fetchAllPrices().finally(() => { fetchPromise = null; });
  }
  return fetchPromise;
}

// Global ticker: all subscribed components get notified together
type Listener = () => void;
const listeners = new Set<Listener>();
let tickerRunning = false;

function startTicker() {
  if (tickerRunning) return;
  tickerRunning = true;
  const tick = async () => {
    await ensureFresh();
    listeners.forEach(fn => fn());
    if (listeners.size > 0) {
      setTimeout(tick, POLL_MS);
    } else {
      tickerRunning = false;
    }
  };
  tick();
}

export function extractCoinId(question: string): string | null {
  const q = question.toLowerCase();
  for (const [keyword, geckoId] of Object.entries(COINGECKO_IDS)) {
    if (geckoId && q.includes(keyword)) return geckoId;
  }
  return null;
}

export function fmtCryptoPrice(p: number): string {
  if (p >= 10_000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (p >= 100) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(6)}`;
}

export interface CryptoPriceData {
  price: number | null;
  prevPrice: number | null;
  direction: 'up' | 'down' | null;
}

export function useCryptoPrice(question: string | undefined): CryptoPriceData {
  const coinId = question ? extractCoinId(question) : null;
  const [price, setPrice] = useState<number | null>(() => coinId ? priceCache[coinId] ?? null : null);
  const prevRef = useRef<number | null>(null);
  const [direction, setDirection] = useState<'up' | 'down' | null>(null);

  const update = useCallback(() => {
    if (!coinId) return;
    const newPrice = priceCache[coinId] ?? null;
    if (newPrice === null) return;

    setPrice(prev => {
      if (prev !== null && prev !== newPrice) {
        prevRef.current = prev;
        setDirection(newPrice > prev ? 'up' : newPrice < prev ? 'down' : null);
      }
      return newPrice;
    });
  }, [coinId]);

  useEffect(() => {
    if (!coinId) return;

    listeners.add(update);
    startTicker();
    // immediate read from cache
    const cached = priceCache[coinId];
    if (cached != null) setPrice(cached);

    return () => { listeners.delete(update); };
  }, [coinId, update]);

  // Auto-clear direction flash after 1.5s
  useEffect(() => {
    if (!direction) return;
    const t = setTimeout(() => setDirection(null), 1500);
    return () => clearTimeout(t);
  }, [direction, price]);

  return { price, prevPrice: prevRef.current, direction };
}
