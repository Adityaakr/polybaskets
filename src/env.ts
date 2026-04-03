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
  PROGRAM_ID: import.meta.env.VITE_PROGRAM_ID || '0xa978905cf582606f76ddf16fc0143a17e5d174974438a5219e26830f69ea0c6e',
  BET_TOKEN_PROGRAM_ID: import.meta.env.VITE_BET_TOKEN_PROGRAM_ID || '0x57461df6d297fedd1c7f187013b3310b510e4bec80f6ce1af8d23e6f4b499cf8',
  BET_LANE_PROGRAM_ID: import.meta.env.VITE_BET_LANE_PROGRAM_ID || '0xb3efdd6db61337d0161ee85dd44f7730d7f32a50dee17c3c2465da036a78c158',
  // Vara.eth (EVM) configuration
  VARAETH_RPC: import.meta.env.VITE_VARAETH_RPC || 'https://hoodi-reth-rpc.gear-tech.io',
  VARAETH_WS: import.meta.env.VITE_VARAETH_WS || 'wss://hoodi-reth-rpc.gear-tech.io/ws',
  VARAETH_ROUTER: import.meta.env.VITE_VARAETH_ROUTER || '0xBC888a8B050B9B76a985d91c815d2c4f2131a58A',
  VARAETH_PROGRAM_ID: import.meta.env.VITE_VARAETH_PROGRAM_ID || '0xa978905cf582606f76ddf16fc0143a17e5d174974438a5219e26830f69ea0c6e',
};

export const isVaraEnabled = () => ENV.ENABLE_VARA;

export const getDefaultBasketAssetKind = (): BasketAssetKind =>
  ENV.ENABLE_VARA ? 'Vara' : 'FT';

export const isBasketAssetKindEnabled = (assetKind?: BasketAssetKind | null): boolean =>
  ENV.ENABLE_VARA || normalizeAssetKind(assetKind) === 'FT';
