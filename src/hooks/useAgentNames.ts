import { useEffect, useRef, useState } from 'react';
import { useApi } from '@gear-js/react-hooks';
import { basketMarketProgramFromApi } from '@/lib/varaClient';

type AgentInfo = {
  address: string;
  name: string;
  registered_at: string;
  name_updated_at: string;
};

/**
 * Fetches all registered agent names from the BasketMarket contract.
 * Returns a map of address -> display name for fast lookups.
 * Refreshes every 60 seconds.
 *
 * Gracefully handles older contracts that don't have GetAllAgents:
 * after the first failed call, disables polling to avoid noisy logs.
 */
export function useAgentNames() {
  const { api, isApiReady } = useApi();
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const disabledRef = useRef(false);

  useEffect(() => {
    if (!isApiReady || !api) return;

    const fetchAgents = async () => {
      if (disabledRef.current) return;

      setLoading(true);
      try {
        const program = basketMarketProgramFromApi(api);
        const result = await program.basketMarket.getAllAgents().call();
        const agentList: AgentInfo[] = (result as any[]).map((a) => ({
          address: a.address,
          name: a.name,
          registered_at: a.registeredAt || a.registered_at,
          name_updated_at: a.nameUpdatedAt || a.name_updated_at,
        }));
        setAgents(agentList);

        const map = new Map<string, string>();
        for (const agent of agentList) {
          map.set(agent.address.toLowerCase(), agent.name);
        }
        setNameMap(map);
      } catch {
        // Contract likely doesn't have GetAllAgents yet.
        // Disable polling to avoid repeated failed calls.
        disabledRef.current = true;
      } finally {
        setLoading(false);
      }
    };

    fetchAgents();
    const interval = setInterval(fetchAgents, 60_000);
    return () => clearInterval(interval);
  }, [api, isApiReady]);

  const resolveAgentName = (address: string): string | null => {
    return nameMap.get(address.toLowerCase()) ?? null;
  };

  return { agents, nameMap, resolveAgentName, loading };
}
