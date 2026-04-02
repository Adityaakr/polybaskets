import { GearApi } from '@gear-js/api';
import type { Signer, SubmittableExtrinsic } from '@polkadot/api/types';
import type { ISubmittableResult } from '@polkadot/types/types';
import { ENV } from '@/env';
import { SailsProgram as BetLaneProgram } from '@/bet-lane-client/lib';
import { SailsProgram as BetTokenProgram } from '@/bet-token-client/lib';

type QueryLike<T> = {
  call: () => Promise<T>;
  run: () => Promise<T>;
};

export const isBetProgramsConfigured = () =>
  Boolean(ENV.BET_TOKEN_PROGRAM_ID && ENV.BET_LANE_PROGRAM_ID);

export const betTokenProgramFromApi = (api: GearApi) => {
  if (!ENV.BET_TOKEN_PROGRAM_ID) {
    throw new Error('VITE_BET_TOKEN_PROGRAM_ID is not set');
  }

  return new BetTokenProgram(api, ENV.BET_TOKEN_PROGRAM_ID as `0x${string}`);
};

export const betLaneProgramFromApi = (api: GearApi) => {
  if (!ENV.BET_LANE_PROGRAM_ID) {
    throw new Error('VITE_BET_LANE_PROGRAM_ID is not set');
  }

  return new BetLaneProgram(api, ENV.BET_LANE_PROGRAM_ID as `0x${string}`);
};

export async function readSailsQuery<T>(builder: QueryLike<T>): Promise<T> {
  try {
    return await builder.call();
  } catch {
    return builder.run();
  }
}

export async function waitForQueryMatch<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  options?: {
    attempts?: number;
    delayMs?: number;
    label?: string;
  },
): Promise<T> {
  const attempts = options?.attempts ?? 8;
  const delayMs = options?.delayMs ?? 1_200;
  const label = options?.label ?? 'query condition';

  let lastValue: T | undefined;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastValue = await read();
    if (matches(lastValue)) {
      return lastValue;
    }

    if (attempt < attempts) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Timed out while waiting for ${label}`);
}

type BatchSendParams = {
  api: GearApi;
  account: string;
  signer: Signer;
  extrinsics: Array<SubmittableExtrinsic<'promise', ISubmittableResult>>;
};

export async function signAndSendBatch({
  api,
  account,
  signer,
  extrinsics,
}: BatchSendParams): Promise<{ txHash: string; blockHash: string }> {
  if (!extrinsics.length) {
    throw new Error('Batch is empty');
  }

  const batchTx = api.tx.utility.batchAll(extrinsics);

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }

      settled = true;

      if (unsubscribe) {
        unsubscribe();
      }

      handler();
    };

    void (async () => {
      try {
        unsubscribe = await batchTx.signAndSend(
          account,
          { signer },
          ({ events, status }) => {
            if (!status.isInBlock) {
              return;
            }

            for (const { event } of events) {
              const { method } = event;

              if (method === 'ExtrinsicFailed') {
                finish(() => reject(api.getExtrinsicFailedError(event)));
                return;
              }

              if (method === 'ExtrinsicSuccess') {
                finish(() =>
                  resolve({
                    txHash: batchTx.hash.toHex(),
                    blockHash: status.asInBlock.toHex(),
                  }),
                );
                return;
              }
            }
          },
        );
      } catch (error) {
        finish(() =>
          reject(error instanceof Error ? error : new Error(String(error))),
        );
      }
    })();
  });
}

export function toBigIntValue(value: number | string | bigint | null | undefined): bigint {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    return BigInt(Math.trunc(value));
  }

  if (typeof value === 'string') {
    if (!value.trim()) {
      return 0n;
    }

    return BigInt(value);
  }

  return 0n;
}

export function toTokenUnits(amount: string, decimals: number): bigint {
  const normalized = amount.trim();
  if (!normalized) {
    throw new Error('Amount is empty');
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Amount must be numeric');
  }

  const [wholePart, fractionalPart = ''] = normalized.split('.');
  const safeWhole = wholePart || '0';
  const safeFraction = fractionalPart.slice(0, decimals).padEnd(decimals, '0');
  const base = 10n ** BigInt(decimals);

  return BigInt(safeWhole) * base + BigInt(safeFraction || '0');
}

export function fromTokenUnits(
  amount: number | string | bigint,
  decimals: number,
  maxFractionDigits = 4,
): string {
  const value = toBigIntValue(amount);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;

  if (fraction === 0n || maxFractionDigits <= 0) {
    return whole.toString();
  }

  const fractionText = fraction
    .toString()
    .padStart(decimals, '0')
    .slice(0, Math.min(decimals, maxFractionDigits))
    .replace(/0+$/, '');

  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
}
