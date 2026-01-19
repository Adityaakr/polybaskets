import { NetworkConfig, NetworkType } from '@/types/basket';

export const NETWORKS: Record<NetworkType, NetworkConfig> = {
  vara: {
    id: 'vara',
    name: 'Vara Network',
    rpcUrl: 'wss://rpc.vara.network',
    programId: '0x...vara_program_id',
    explorerBase: 'https://vara.subscan.io',
  },
  varaeth: {
    id: 'varaeth',
    name: 'Vara.eth',
    rpcUrl: 'https://eth.vara.network',
    programId: '0x...varaeth_program_id',
    explorerBase: 'https://eth.vara.network/explorer',
  },
};

export function getNetworkConfig(network: NetworkType): NetworkConfig {
  return NETWORKS[network];
}

export function getExplorerUrl(network: NetworkType, txHash: string): string {
  const config = NETWORKS[network];
  return `${config.explorerBase}/tx/${txHash}`;
}

export function getAddressExplorerUrl(network: NetworkType, address: string): string {
  const config = NETWORKS[network];
  return `${config.explorerBase}/account/${address}`;
}
