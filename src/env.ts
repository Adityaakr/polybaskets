import type { BasketAssetKind } from '@/types/basket.ts';
import { normalizeAssetKind } from '@/lib/assetKind.ts';

const parseBooleanEnv = (value: unknown, fallback: boolean): boolean => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const normalizeUrl = (value: string): string => value.replace(/\/+$/, '');

export const ENV = {
  ENABLE_VARA: parseBooleanEnv(import.meta.env.VITE_ENABLE_VARA, false),
  NODE_ADDRESS: import.meta.env.VITE_NODE_ADDRESS || 'wss://testnet.vara.network',
  PROGRAM_ID: import.meta.env.VITE_PROGRAM_ID || '0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea',
  BET_TOKEN_PROGRAM_ID: import.meta.env.VITE_BET_TOKEN_PROGRAM_ID || '0xad1a120f24f62eb68537791fe94c3b381e81677e9bd73d811c319838846c27dd',
  BET_LANE_PROGRAM_ID: import.meta.env.VITE_BET_LANE_PROGRAM_ID || '0x40dc1597c8e3beb3523f9c05ad2b44e00a11be6e665da20e4323bb7dfae1ecda',
  INDEXER_GRAPHQL_ENDPOINT: import.meta.env.VITE_INDEXER_GRAPHQL_ENDPOINT || 'http://localhost:4350/graphql',
  BET_QUOTE_SERVICE_URL: import.meta.env.VITE_BET_QUOTE_SERVICE_URL || 'http://127.0.0.1:4360',
  // Vara.eth (EVM) configuration
  VARAETH_RPC: import.meta.env.VITE_VARAETH_RPC || 'https://hoodi-reth-rpc.gear-tech.io',
  VARAETH_WS: import.meta.env.VITE_VARAETH_WS || 'wss://hoodi-reth-rpc.gear-tech.io/ws',
  VARAETH_ROUTER: import.meta.env.VITE_VARAETH_ROUTER || '0xBC888a8B050B9B76a985d91c815d2c4f2131a58A',
  VARAETH_PROGRAM_ID: import.meta.env.VITE_VARAETH_PROGRAM_ID || '0x1fa6fd12433accef350a68da4555a2a71acab261c4ae9eb713033023fc0775ea',
};

export const getLaunchAppUrl = (): string => {
  const configuredUrl = import.meta.env.VITE_APP_URL;
  if (typeof configuredUrl === 'string' && configuredUrl.trim()) {
    return normalizeUrl(configuredUrl.trim());
  }

  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    if (hostname === 'polybaskets.xyz' || hostname === 'www.polybaskets.xyz') {
      return 'https://app.polybaskets.xyz';
    }
  }

  return '/explorer';
};

export const isVaraEnabled = () => ENV.ENABLE_VARA;

export const getDefaultBasketAssetKind = (): BasketAssetKind =>
  ENV.ENABLE_VARA ? 'Vara' : 'FT';

export const isBasketAssetKindEnabled = (assetKind?: BasketAssetKind | null): boolean =>
  ENV.ENABLE_VARA || normalizeAssetKind(assetKind) === 'FT';
