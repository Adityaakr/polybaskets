// Vara.eth client for basket market operations
import { createPublicClient, createWalletClient, http, custom, type PublicClient, type WalletClient } from 'viem';
import { EthereumClient } from '@vara-eth/api';
import { ENV } from '@/env.ts';
import { hoodiChain } from './evmWallet.ts';
import { SailsProgram } from '@/basket-market-client/lib.ts';

// Create EthereumClient for Vara.eth
export async function createVaraEthEthereumClient(
  publicClient: PublicClient,
  walletClient: WalletClient
): Promise<EthereumClient> {
  const routerAddress = (ENV.VARAETH_ROUTER || '0xBC888a8B050B9B76a985d91c815d2c4f2131a58A') as `0x${string}`;
  const client = new EthereumClient(publicClient, walletClient, routerAddress);
  await client.isInitialized;
  return client;
}

// Note: SailsProgram is designed for GearApi (Polkadot-based Vara Network)
// For Vara.eth, we need to use EthereumClient directly with proper encoding
// See varaEthBasketClient.ts for Vara.eth-specific implementation

// Helper to create public and wallet clients from MetaMask account
// Automatically switches to Hoodi network if needed
export async function createVaraEthClients(accountAddress: string): Promise<{
  publicClient: PublicClient;
  walletClient: WalletClient;
  ethereumClient: EthereumClient;
}> {
  // Ensure we're on Hoodi network
  const { switchToHoodiNetwork, isOnHoodiNetwork } = await import('./evmWallet.ts');
  const isCorrectNetwork = await isOnHoodiNetwork();
  if (!isCorrectNetwork) {
    console.log('[VaraEth] Switching to Hoodi testnet...');
    await switchToHoodiNetwork();
  }
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('MetaMask is not available. Please install MetaMask.');
  }

  const publicClient = createPublicClient({
    chain: hoodiChain,
    transport: http(ENV.VARAETH_RPC || 'https://hoodi-reth-rpc.gear-tech.io'),
  });

  // Use custom transport with window.ethereum for proper MetaMask integration
  const walletClient = createWalletClient({
    account: accountAddress as `0x${string}`,
    chain: hoodiChain,
    transport: custom(window.ethereum),
  });

  const ethereumClient = await createVaraEthEthereumClient(publicClient, walletClient);

  return { publicClient, walletClient, ethereumClient };
}

// wVARA has 12 decimals (not 18 like ETH)
export const WVARA_DECIMALS = 12n;

// Convert wVARA amount to smallest unit (12 decimals)
export const toWVara = (amount: string | number): bigint => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return BigInt(Math.floor(num * 10 ** Number(WVARA_DECIMALS)));
};

// Convert from smallest unit to wVARA (12 decimals)
export const fromWVara = (amount: bigint): string => {
  const base = Number(amount) / 10 ** Number(WVARA_DECIMALS);
  return base.toFixed(4).replace(/\.0+$/, '');
};

// Legacy ETH functions (kept for compatibility, but we use wVARA)
export const ETH_DECIMALS = 18n;
export const toWei = toWVara; // Use wVARA conversion
export const fromWei = fromWVara; // Use wVARA conversion
