import type { BasketAssetKind } from '@/types/basket';
import { normalizeAssetKind } from '@/lib/assetKind';

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

export const ENV = {
  ENABLE_VARA: parseBooleanEnv(import.meta.env.VITE_ENABLE_VARA, false),
  NODE_ADDRESS: import.meta.env.VITE_NODE_ADDRESS || 'wss://testnet.vara.network',
  PROGRAM_ID: import.meta.env.VITE_PROGRAM_ID || '0x4991ecaf71990ab5c6bdc8c413c85b67831fd9ecf01105f9e22e6bf50029523c',
  BET_TOKEN_PROGRAM_ID: import.meta.env.VITE_BET_TOKEN_PROGRAM_ID || '0x0a54e06ac29344f127d90b669f4fcd9de86efa4a67c3b8568f6182cf203d4294',
  BET_LANE_PROGRAM_ID: import.meta.env.VITE_BET_LANE_PROGRAM_ID || '0x307cdda388890a75d384b3f155aaaf0b99c328f239f24dc2394a876c5c1b6863',
  INDEXER_GRAPHQL_ENDPOINT: import.meta.env.VITE_INDEXER_GRAPHQL_ENDPOINT || 'http://localhost:4350/graphql',
  BET_QUOTE_SERVICE_URL: import.meta.env.VITE_BET_QUOTE_SERVICE_URL || 'http://127.0.0.1:4360',
  // Vara.eth (EVM) configuration
  VARAETH_RPC: import.meta.env.VITE_VARAETH_RPC || 'https://hoodi-reth-rpc.gear-tech.io',
  VARAETH_WS: import.meta.env.VITE_VARAETH_WS || 'wss://hoodi-reth-rpc.gear-tech.io/ws',
  VARAETH_ROUTER: import.meta.env.VITE_VARAETH_ROUTER || '0xBC888a8B050B9B76a985d91c815d2c4f2131a58A',
  VARAETH_PROGRAM_ID: import.meta.env.VITE_VARAETH_PROGRAM_ID || '0x4991ecaf71990ab5c6bdc8c413c85b67831fd9ecf01105f9e22e6bf50029523c',
};

export const isVaraEnabled = () => ENV.ENABLE_VARA;

export const getDefaultBasketAssetKind = (): BasketAssetKind =>
  ENV.ENABLE_VARA ? 'Vara' : 'FT';

export const isBasketAssetKindEnabled = (assetKind?: BasketAssetKind | null): boolean =>
  ENV.ENABLE_VARA || normalizeAssetKind(assetKind) === 'FT';
