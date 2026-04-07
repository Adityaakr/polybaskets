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

export const ENV = {
  ENABLE_VARA: parseBooleanEnv(import.meta.env.VITE_ENABLE_VARA, false),
  NODE_ADDRESS: import.meta.env.VITE_NODE_ADDRESS || 'wss://testnet.vara.network',
  PROGRAM_ID: import.meta.env.VITE_PROGRAM_ID || '0x43b9703636ea9eda9e25398962adb6c19cba9a4a20fa6b3dd2e66a244ff6d04a',
  BET_TOKEN_PROGRAM_ID: import.meta.env.VITE_BET_TOKEN_PROGRAM_ID || '0x16aa2dff1365dd04733306a39205cf1bc2a730d8b8d488d0467b98cfdf2a88c1',
  BET_LANE_PROGRAM_ID: import.meta.env.VITE_BET_LANE_PROGRAM_ID || '0x501921de35cbd677c724449761b8477cf8fbb41e603deab80f68565943def59a',
  INDEXER_GRAPHQL_ENDPOINT: import.meta.env.VITE_INDEXER_GRAPHQL_ENDPOINT || 'http://localhost:4350/graphql',
  BET_QUOTE_SERVICE_URL: import.meta.env.VITE_BET_QUOTE_SERVICE_URL || 'http://127.0.0.1:4360',
  // Vara.eth (EVM) configuration
  VARAETH_RPC: import.meta.env.VITE_VARAETH_RPC || 'https://hoodi-reth-rpc.gear-tech.io',
  VARAETH_WS: import.meta.env.VITE_VARAETH_WS || 'wss://hoodi-reth-rpc.gear-tech.io/ws',
  VARAETH_ROUTER: import.meta.env.VITE_VARAETH_ROUTER || '0xBC888a8B050B9B76a985d91c815d2c4f2131a58A',
  VARAETH_PROGRAM_ID: import.meta.env.VITE_VARAETH_PROGRAM_ID || '0x43b9703636ea9eda9e25398962adb6c19cba9a4a20fa6b3dd2e66a244ff6d04a',
};

export const isVaraEnabled = () => ENV.ENABLE_VARA;

export const getDefaultBasketAssetKind = (): BasketAssetKind =>
  ENV.ENABLE_VARA ? 'Vara' : 'FT';

export const isBasketAssetKindEnabled = (assetKind?: BasketAssetKind | null): boolean =>
  ENV.ENABLE_VARA || normalizeAssetKind(assetKind) === 'FT';
