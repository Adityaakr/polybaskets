import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { NetworkType, NetworkConfig } from '@/types/basket';
import { getNetworkConfig, NETWORKS } from '@/lib/network';

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

  return (
    <NetworkContext.Provider value={{ network, config, setNetwork }}>
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
