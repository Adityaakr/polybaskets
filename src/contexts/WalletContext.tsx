import React, { ReactNode, createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { useAccount } from '@gear-js/react-hooks';
import { useNetwork } from './NetworkContext';
import { 
  getMetaMaskAccount, 
  requestMetaMaskConnection, 
  isMetaMaskInstalled,
  switchToHoodiNetwork,
  isOnHoodiNetwork
} from '@/lib/evmWallet';

interface WalletContextType {
  address: string | null;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { network } = useNetwork();
  const gearAccount = useAccount();
  
  // EVM wallet state
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [isConnectingEVM, setIsConnectingEVM] = useState(false);

  // Load EVM account on mount and network change
  useEffect(() => {
    if (network === 'varaeth') {
      loadEVMAccount();
      
      // Listen for account and chain changes
      if (typeof window !== 'undefined' && window.ethereum) {
        const handleChainChanged = () => {
          // Reload account when chain changes
          loadEVMAccount();
        };
        
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);
        
        return () => {
          window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
          window.ethereum?.removeListener('chainChanged', handleChainChanged);
        };
      }
    } else {
      setEvmAddress(null);
    }
  }, [network]);

  const loadEVMAccount = async () => {
    try {
      const account = await getMetaMaskAccount();
      setEvmAddress(account);
    } catch (error) {
      console.error('Error loading EVM account:', error);
      setEvmAddress(null);
    }
  };

  const handleAccountsChanged = (accounts: string[]) => {
    setEvmAddress(accounts[0] || null);
  };

  const connectEVM = useCallback(async () => {
    if (!isMetaMaskInstalled()) {
      throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
    }

    setIsConnectingEVM(true);
    try {
      // requestMetaMaskConnection already switches to Hoodi network
      const account = await requestMetaMaskConnection();
      setEvmAddress(account);
      
      // Verify we're on the correct network
      const isCorrect = await isOnHoodiNetwork();
      if (!isCorrect) {
        console.warn('[VaraEth] Wallet may not be on Hoodi network. Transactions may fail.');
      }
    } catch (error) {
      console.error('Error connecting EVM wallet:', error);
      throw error;
    } finally {
      setIsConnectingEVM(false);
    }
  }, []);

  const disconnectEVM = useCallback(() => {
    setEvmAddress(null);
  }, []);

  const value = useMemo<WalletContextType>(() => {
    if (network === 'varaeth') {
      return {
        address: evmAddress,
        isConnecting: isConnectingEVM,
        connect: connectEVM,
        disconnect: disconnectEVM,
      };
    } else {
      // Vara Network - use Gear wallet
      return {
        address: gearAccount.account?.address || null,
        isConnecting: !gearAccount.isAccountReady,
        connect: async () => {
          if (gearAccount.login) {
            gearAccount.login();
          }
        },
        disconnect: () => {
          if (gearAccount.logout) {
            gearAccount.logout();
          }
        },
      };
    }
  }, [
    network,
    evmAddress,
    isConnectingEVM,
    connectEVM,
    disconnectEVM,
    gearAccount.account?.address,
    gearAccount.isAccountReady,
    gearAccount.login,
    gearAccount.logout,
  ]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
