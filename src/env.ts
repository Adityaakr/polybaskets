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

const parseNumberEnv = (value: unknown, fallback: number): number => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeUrl = (value: string): string => value.replace(/\/+$/, '');

export const ENV = {
  ENABLE_VARA: parseBooleanEnv(import.meta.env.VITE_ENABLE_VARA, false),
  EXPLORER_HOLD_ENABLED: parseBooleanEnv(import.meta.env.VITE_EXPLORER_HOLD_ENABLED, false),
  NODE_ADDRESS: import.meta.env.VITE_NODE_ADDRESS || 'wss://testnet.vara.network',
  PROGRAM_ID: import.meta.env.VITE_PROGRAM_ID || '0x702395d43248eaa5f1fd4d9eadadc75b0fb1c7c5ae9ea20bf31375fd4358f403',
  BET_TOKEN_PROGRAM_ID: import.meta.env.VITE_BET_TOKEN_PROGRAM_ID || '0x41be634b690ecde3d79f63ea2db9834b8570a6d4abb3c0be47af3947e3129ece',
  BET_LANE_PROGRAM_ID: import.meta.env.VITE_BET_LANE_PROGRAM_ID || '0xf5aa436669bb3fc97c1675d06949592e8617f889cbd055451f321113b17bb564',
  INDEXER_GRAPHQL_ENDPOINT: import.meta.env.VITE_INDEXER_GRAPHQL_ENDPOINT || 'http://localhost:4350/graphql',
  BET_QUOTE_SERVICE_URL: import.meta.env.VITE_BET_QUOTE_SERVICE_URL || 'http://127.0.0.1:4360',
  CONTEST_DAY_BOUNDARY_OFFSET_MS: parseNumberEnv(
    import.meta.env.VITE_CONTEST_DAY_BOUNDARY_OFFSET_MS,
    43_200_000,
  ),
  EXPLORER_HOLD_BADGE: import.meta.env.VITE_EXPLORER_HOLD_BADGE || 'Temporary pause',
  EXPLORER_HOLD_TITLE:
    import.meta.env.VITE_EXPLORER_HOLD_TITLE || 'PolyBaskets is taking a short pause',
  EXPLORER_HOLD_MESSAGE:
    import.meta.env.VITE_EXPLORER_HOLD_MESSAGE ||
    'We are polishing the next launch experience. Stay close, the app will reopen soon and we would love to have you there on day one.',
  EXPLORER_HOLD_PRIMARY_CTA_LABEL:
    import.meta.env.VITE_EXPLORER_HOLD_PRIMARY_CTA_LABEL || 'Get launch updates',
  EXPLORER_HOLD_PRIMARY_CTA_URL:
    import.meta.env.VITE_EXPLORER_HOLD_PRIMARY_CTA_URL || 'https://t.me/polybaskets',
  // Vara.eth (EVM) configuration
  VARAETH_RPC: import.meta.env.VITE_VARAETH_RPC || 'https://hoodi-reth-rpc.gear-tech.io',
  VARAETH_WS: import.meta.env.VITE_VARAETH_WS || 'wss://hoodi-reth-rpc.gear-tech.io/ws',
  VARAETH_ROUTER: import.meta.env.VITE_VARAETH_ROUTER || '0xBC888a8B050B9B76a985d91c815d2c4f2131a58A',
  VARAETH_PROGRAM_ID: import.meta.env.VITE_VARAETH_PROGRAM_ID || '0x702395d43248eaa5f1fd4d9eadadc75b0fb1c7c5ae9ea20bf31375fd4358f403',
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
