import type { SignedBetQuote } from '@/bet-lane-client/lib';
import { ENV } from '@/env';

export type BetQuoteRequest = {
  targetProgramId: `0x${string}`;
  user: `0x${string}`;
  basketId: number;
  amount: string;
};

type BetQuoteResponse = {
  payload: {
    target_program_id: `0x${string}`;
    user: `0x${string}`;
    basket_id: number | string;
    amount: string;
    quoted_index_bps: number;
    deadline_ms: number | string;
    nonce: string;
  };
  signature: `0x${string}`;
};

const getBetQuoteServiceUrl = () => {
  const value = ENV.BET_QUOTE_SERVICE_URL;
  if (!value) {
    throw new Error('VITE_BET_QUOTE_SERVICE_URL is not configured');
  }

  return value.replace(/\/+$/, '');
};

export async function requestBetQuote(
  request: BetQuoteRequest,
): Promise<SignedBetQuote> {
  const response = await fetch(`${getBetQuoteServiceUrl()}/api/bet-lane/quote`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Quote service returned ${response.status}`);
  }

  const quote = (await response.json()) as BetQuoteResponse;

  return {
    payload: {
      target_program_id: quote.payload.target_program_id,
      user: quote.payload.user,
      basket_id: quote.payload.basket_id,
      amount: quote.payload.amount,
      quoted_index_bps: quote.payload.quoted_index_bps,
      deadline_ms: quote.payload.deadline_ms,
      nonce: quote.payload.nonce,
    },
    signature: quote.signature,
  };
}
