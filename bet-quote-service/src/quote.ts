import { randomBytes } from 'node:crypto';
import { Keyring } from '@polkadot/api';
import { TypeRegistry } from '@polkadot/types';
import { stringToU8a, u8aToHex } from '@polkadot/util';
import type { ChainBasket, Outcome } from './chain.js';
import { extractYesNoPrices, fetchMarketById, fetchMarketBySlug } from './polymarket.js';

type QuoteServiceOptions = {
  signerSeed: string;
  targetProgramId: `0x${string}`;
  gammaBaseUrl: string;
  ttlMs: number;
  bindingPrefix: string;
};

export type BetQuoteInput = {
  user: `0x${string}`;
  basketId: number;
  amount: bigint;
  basket: ChainBasket;
};

const registry = new TypeRegistry();
registry.register({
  BetQuotePayload: {
    target_program_id: '[u8;32]',
    user: '[u8;32]',
    basket_id: 'u64',
    amount: 'u256',
    quoted_index_bps: 'u16',
    deadline_ms: 'u64',
    nonce: 'u128',
  },
});

const normalizeOutcome = (outcome: Outcome): 'YES' | 'NO' => {
  if (typeof outcome === 'string') {
    return outcome;
  }

  if ('YES' in outcome) {
    return 'YES';
  }

  return 'NO';
};

const clampIndexBps = (value: number): number => Math.max(1, Math.min(10_000, Math.round(value)));

export class QuoteService {
  private readonly keypair;

  constructor(private readonly options: QuoteServiceOptions) {
    const keyring = new Keyring({ type: 'sr25519', ss58Format: 137 });
    this.keypair = keyring.addFromUri(options.signerSeed);
  }

  getSignerActorId(): `0x${string}` {
    return u8aToHex(this.keypair.publicKey) as `0x${string}`;
  }

  async createSignedQuote(input: BetQuoteInput) {
    const quotedIndexBps = await this.computeQuotedIndexBps(input.basket);
    const payload = {
      target_program_id: this.options.targetProgramId,
      user: input.user,
      basket_id: input.basketId,
      amount: input.amount.toString(),
      quoted_index_bps: quotedIndexBps,
      deadline_ms: BigInt(Date.now() + this.options.ttlMs).toString(),
      nonce: BigInt(`0x${randomBytes(16).toString('hex')}`).toString(),
    };

    const encodedPayload = registry.createType('BetQuotePayload', payload).toU8a();
    const message = new Uint8Array([
      ...stringToU8a('<Bytes>'),
      ...stringToU8a(this.options.bindingPrefix),
      ...encodedPayload,
      ...stringToU8a('</Bytes>'),
    ]);
    const signature = this.keypair.sign(message);

    return {
      payload,
      signature: u8aToHex(signature) as `0x${string}`,
    };
  }

  private async computeQuotedIndexBps(basket: ChainBasket): Promise<number> {
    let weightedTotal = 0;

    for (const item of basket.items) {
      const market =
        (item.poly_market_id
          ? await fetchMarketById(item.poly_market_id, this.options.gammaBaseUrl)
          : null) ??
        (item.poly_slug
          ? await fetchMarketBySlug(item.poly_slug, this.options.gammaBaseUrl)
          : null);

      if (!market) {
        throw new Error(`Failed to load Polymarket data for basket item ${item.poly_slug || item.poly_market_id}`);
      }

      const prices = extractYesNoPrices(market);
      if (!prices) {
        throw new Error(`Missing YES/NO prices for basket item ${item.poly_slug || item.poly_market_id}`);
      }

      const selectedOutcome = normalizeOutcome(item.selected_outcome);
      const selectedPrice = selectedOutcome === 'YES' ? prices.yesPrice : prices.noPrice;
      weightedTotal += selectedPrice * item.weight_bps;
    }

    return clampIndexBps(weightedTotal);
  }
}
