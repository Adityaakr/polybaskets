import { Injectable } from '@nestjs/common';
import { signatureVerify } from '@polkadot/util-crypto';
import { hexToU8a, stringToU8a } from '@polkadot/util';

export type AgentAction = 'register' | 'update';

export interface AgentSignedPayload {
  ss58: string;
  action: AgentAction;
  label?: string;
  texts?: Record<string, string>;
  metadata?: Record<string, string>;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  audience: 'polybaskets.eth';
}

const PAYLOAD_KEY_ORDER: (keyof AgentSignedPayload)[] = [
  'ss58',
  'action',
  'label',
  'texts',
  'metadata',
  'nonce',
  'issuedAt',
  'expiresAt',
  'audience',
];

function sortObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sortObject);
  if (typeof obj !== 'object') return obj;
  const sorted: any = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortObject(obj[key]);
  }
  return sorted;
}

export function canonicalize(payload: AgentSignedPayload): Uint8Array {
  const ordered: any = {};
  for (const key of PAYLOAD_KEY_ORDER) {
    if (payload[key] !== undefined) {
      ordered[key] = sortObject(payload[key]);
    }
  }
  return stringToU8a(JSON.stringify(ordered));
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_signature' | 'malformed_signature' };

@Injectable()
export class SignatureVerifier {
  verify(payload: AgentSignedPayload, signatureHex: string): VerifyResult {
    if (!/^0x[0-9a-fA-F]+$/.test(signatureHex)) {
      return { ok: false, reason: 'malformed_signature' };
    }
    try {
      const message = canonicalize(payload);
      const sig = hexToU8a(signatureHex);
      const result = signatureVerify(message, sig, payload.ss58);
      return result.isValid ? { ok: true } : { ok: false, reason: 'invalid_signature' };
    } catch {
      return { ok: false, reason: 'malformed_signature' };
    }
  }
}
