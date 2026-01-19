// Hook to get Vara.eth basket market client
import { useMemo } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useNetwork } from '@/contexts/NetworkContext';
import { createVaraEthClients } from '@/lib/varaEthClient';
import { createVaraEthBasketMarket, VaraEthBasketMarket } from '@/lib/varaEthBasketClient';
import { useState, useEffect } from 'react';

export function useVaraEthBasketMarket(): {
  basketMarket: VaraEthBasketMarket | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { address } = useWallet();
  const { network } = useNetwork();
  const [basketMarket, setBasketMarket] = useState<VaraEthBasketMarket | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (network !== 'varaeth' || !address) {
      setBasketMarket(null);
      setError(null);
      return;
    }

    const initClient = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { ethereumClient, publicClient, walletClient } = await createVaraEthClients(address);
        const market = createVaraEthBasketMarket(ethereumClient, address as `0x${string}`, publicClient, walletClient);
        setBasketMarket(market);
      } catch (err) {
        console.error('Failed to create Vara.eth basket market client:', err);
        setError(err instanceof Error ? err : new Error('Failed to initialize client'));
        setBasketMarket(null);
      } finally {
        setIsLoading(false);
      }
    };

    initClient();
  }, [network, address]);

  return { basketMarket, isLoading, error };
}
