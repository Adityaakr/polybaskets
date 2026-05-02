import { useEffect, useMemo, useRef, useState } from 'react';
import { registrar, SubnameRecord } from '@/lib/agentRegistrar';

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  fetchedAt: number;
  value: SubnameRecord | null;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<SubnameRecord | null>>();

async function fetchOne(ss58: string): Promise<SubnameRecord | null> {
  const cached = cache.get(ss58);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  const existing = inflight.get(ss58);
  if (existing) return existing;
  const promise = registrar.byAddress(ss58).then(
    (value) => {
      cache.set(ss58, { fetchedAt: Date.now(), value });
      inflight.delete(ss58);
      return value;
    },
    (err) => {
      inflight.delete(ss58);
      throw err;
    },
  );
  inflight.set(ss58, promise);
  return promise;
}

async function fetchMany(
  ss58s: string[],
): Promise<Record<string, SubnameRecord | null>> {
  const fresh: string[] = [];
  const result: Record<string, SubnameRecord | null> = {};
  const now = Date.now();
  for (const s of ss58s) {
    const cached = cache.get(s);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      result[s] = cached.value;
    } else {
      fresh.push(s);
    }
  }
  if (fresh.length === 0) return result;
  const fetched = await registrar.byAddresses(fresh);
  for (const [k, v] of Object.entries(fetched)) {
    cache.set(k, { fetchedAt: Date.now(), value: v });
    result[k] = v;
  }
  return result;
}

export function useAgentSubname(ss58: string | null | undefined) {
  const [data, setData] = useState<SubnameRecord | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!ss58) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchOne(ss58)
      .then((v) => {
        if (!cancelled) setData(v);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ss58]);
  return { data, loading };
}

export function useAgentSubnames(ss58s: string[]) {
  const [map, setMap] = useState<Record<string, SubnameRecord | null>>({});
  const [loading, setLoading] = useState(false);
  const key = useMemo(() => [...ss58s].sort().join('|'), [ss58s]);
  const lastKey = useRef('');
  useEffect(() => {
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (ss58s.length === 0) {
      setMap({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Slice in chunks of 100 to respect bulk limit.
    const chunks: string[][] = [];
    for (let i = 0; i < ss58s.length; i += 100) {
      chunks.push(ss58s.slice(i, i + 100));
    }
    Promise.all(chunks.map(fetchMany))
      .then((results) => {
        if (cancelled) return;
        const merged: Record<string, SubnameRecord | null> = {};
        for (const r of results) Object.assign(merged, r);
        setMap(merged);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const resolveLabel = (ss58: string): string | null => {
    return map[ss58]?.label ?? null;
  };
  return { map, resolveLabel, loading };
}
