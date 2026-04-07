import { useEffect, useState } from 'react';
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
 */
export function useAgentNames() {
  const { api, isApiReady } = useApi();
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isApiReady || !api) return;

    const fetchAgents = async () => {
      setLoading(true);
      try {
        const program = basketMarketProgramFromApi(api);
        const result = await program.basketMarket.getAllAgents();
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
      } catch (err) {
        console.error('[useAgentNames] Failed to fetch agents:', err);
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
