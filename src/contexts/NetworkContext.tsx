import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { NetworkType, NetworkConfig } from '@/types/basket.ts';
import { getNetworkConfig, NETWORKS } from '@/lib/network.ts';

interface NetworkContextType {
  network: NetworkType;
  config: NetworkConfig;
  setNetwork: (network: NetworkType) => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetworkState] = useState<NetworkType>('vara');

  const setNetwork = useCallback((newNetwork: NetworkType) => {
    setNetworkState(newNetwork);
  }, []);

  const config = getNetworkConfig(network);

  const value = useMemo(
    () => ({ network, config, setNetwork }),
    [network, config, setNetwork]
  );

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}
