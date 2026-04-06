// EVM wallet utilities for Vara.eth network
import { createPublicClient, createWalletClient, http, custom, type PublicClient, type WalletClient } from 'viem';
import { EthereumClient } from '@vara-eth/api';
import { ENV } from '@/env.ts';

// Hoodi testnet chain definition
export const hoodiChain = {
  id: 560048,
  name: 'Hoodi Testnet',
  network: 'hoodi',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: { 
    default: { 
      http: [ENV.VARAETH_RPC || 'https://hoodi-reth-rpc.gear-tech.io'] 
    } 
  },
  testnet: true,
} as const;

// Create public client for Vara.eth
export function createVaraEthPublicClient(): PublicClient {
  return createPublicClient({
    chain: hoodiChain,
    transport: http(ENV.VARAETH_RPC || 'https://hoodi-reth-rpc.gear-tech.io'),
  });
}

// Create wallet client from MetaMask
export async function createVaraEthWalletClient(accountAddress: string): Promise<WalletClient | null> {
  if (typeof window === 'undefined' || !window.ethereum) {
    return null;
  }

  // Use custom transport with window.ethereum for proper MetaMask integration
  return createWalletClient({
    account: accountAddress as `0x${string}`,
    chain: hoodiChain,
    transport: custom(window.ethereum),
  });
}

// Create EthereumClient for Vara.eth
export async function createEthereumClient(
  publicClient: PublicClient,
  walletClient: WalletClient
): Promise<EthereumClient> {
  const routerAddress = (ENV.VARAETH_ROUTER || '0xBC888a8B050B9B76a985d91c815d2c4f2131a58A') as `0x${string}`;
  const client = new EthereumClient(publicClient, walletClient, routerAddress);
  await client.isInitialized;
  return client;
}

// Check if MetaMask is installed
export function isMetaMaskInstalled(): boolean {
  return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined';
}

// Get current MetaMask account
export async function getMetaMaskAccount(): Promise<string | null> {
  if (!isMetaMaskInstalled()) {
    return null;
  }

  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    return accounts[0] || null;
  } catch {
    return null;
  }
}

// Switch MetaMask to Hoodi testnet
export async function switchToHoodiNetwork(): Promise<void> {
  if (!isMetaMaskInstalled()) {
    throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
  }

  const chainId = `0x${hoodiChain.id.toString(16)}`;
  
  try {
    // Try to switch to Hoodi network
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    });
  } catch (error: any) {
    // If chain doesn't exist in MetaMask, add it
    if (error.code === 4902 || error.code === -32603) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId,
              chainName: hoodiChain.name,
              nativeCurrency: hoodiChain.nativeCurrency,
              rpcUrls: hoodiChain.rpcUrls.default.http,
              blockExplorerUrls: ['https://explorer.hoodi.network'],
            },
          ],
        });
      } catch (addError: any) {
        if (addError.code === 4001) {
          throw new Error('User rejected adding Hoodi testnet to MetaMask.');
        }
        throw new Error(`Failed to add Hoodi testnet: ${addError.message}`);
      }
    } else if (error.code === 4001) {
      throw new Error('User rejected switching to Hoodi testnet.');
    } else {
      throw new Error(`Failed to switch network: ${error.message}`);
    }
  }
}

// Request MetaMask connection and ensure correct network
export async function requestMetaMaskConnection(): Promise<string | null> {
  if (!isMetaMaskInstalled()) {
    throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
  }

  try {
    // First, switch to Hoodi network
    await switchToHoodiNetwork();
    
    // Then request accounts
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    return accounts[0] || null;
  } catch (error: any) {
    if (error.code === 4001 || error.message?.includes('rejected')) {
      throw new Error('User rejected the connection request.');
    }
    throw error;
  }
}

// Check if wallet is on correct network
export async function isOnHoodiNetwork(): Promise<boolean> {
  if (!isMetaMaskInstalled()) {
    return false;
  }

  try {
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    const currentChainId = parseInt(chainId as string, 16);
    return currentChainId === hoodiChain.id;
  } catch {
    return false;
  }
}
