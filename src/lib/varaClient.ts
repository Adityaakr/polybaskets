import { GearApi } from '@gear-js/api';
import { decodeAddress } from '@polkadot/util-crypto';
import { SailsProgram as BasketMarketProgram } from '@/basket-market-client/lib.ts';
import { ENV } from '@/env.ts';

export const TVARA_DECIMALS = 12n;
export const toVara = (amount: string | number): bigint => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return BigInt(Math.floor(num * 10 ** Number(TVARA_DECIMALS)));
};
export const fromVara = (amount: bigint): string => {
  const base = Number(amount) / 10 ** Number(TVARA_DECIMALS);
  return base.toFixed(4).replace(/\.0+$/, '');
};

export const basketMarketProgramFromApi = (api: GearApi) => {
  if (!ENV.PROGRAM_ID) {
    throw new Error('PROGRAM_ID is not set in environment variables. Please set VITE_PROGRAM_ID in your .env file');
  }
  if (!ENV.PROGRAM_ID.startsWith('0x')) {
    throw new Error(`Invalid PROGRAM_ID format. Expected hex string starting with 0x, got: ${ENV.PROGRAM_ID}`);
  }
  return new BasketMarketProgram(api, ENV.PROGRAM_ID as `0x${string}`);
};

export const actorIdFromAddress = (address: string): `0x${string}` => {
  const bytes = decodeAddress(address);
  const hexBody = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `0x${hexBody}` as `0x${string}`;
};
