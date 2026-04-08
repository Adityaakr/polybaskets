import 'dotenv/config';
import { readFileSync } from 'node:fs';

const getOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const getRequiredEnv = (name: string): string => {
  const value = getOptionalEnv(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
};

const getRequiredHexEnv = (name: string): `0x${string}` => {
  const value = getRequiredEnv(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Invalid ${name}: expected 32-byte hex ActorId`);
  }

  return value as `0x${string}`;
};

const getNumberEnv = (name: string, fallback: string): number => {
  const value = Number(getOptionalEnv(name) ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: expected a positive number`);
  }

  return value;
};

const getBooleanEnv = (name: string, fallback: string): boolean => {
  const value = (getOptionalEnv(name) ?? fallback).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid ${name}: expected true or false`);
};

const normalizeMnemonic = (value: string): string =>
  value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');

const getSharedSettlerSeed = (): string => {
  const seed = getOptionalEnv('SETTLER_SEED');
  const seedFile = getOptionalEnv('SETTLER_SEED_FILE');

  if (seed && seedFile) {
    throw new Error('Set exactly one of SETTLER_SEED or SETTLER_SEED_FILE');
  }

  if (seedFile) {
    const fileValue = readFileSync(seedFile, 'utf8').trim();
    if (!fileValue) {
      throw new Error(`SETTLER_SEED_FILE is empty: ${seedFile}`);
    }

    return normalizeMnemonic(fileValue);
  }

  if (seed) {
    return normalizeMnemonic(seed);
  }

  throw new Error('Missing shared bot secret: set SETTLER_SEED or SETTLER_SEED_FILE');
};

export const config = {
  varaRpcUrl: getRequiredEnv('VARA_RPC_URL'),
  basketMarketProgramId: getRequiredHexEnv('BASKET_MARKET_PROGRAM_ID'),
  settlerSeed: getSharedSettlerSeed(),
  pollIntervalMs: getNumberEnv('SETTLER_BOT_POLL_INTERVAL_MS', '30000'),
  shouldFinalize: getBooleanEnv('SETTLER_BOT_FINALIZE_ENABLED', 'true'),
  polymarketGammaBaseUrl:
    getOptionalEnv('POLYMARKET_GAMMA_BASE_URL') ?? 'https://gamma-api.polymarket.com',
};
