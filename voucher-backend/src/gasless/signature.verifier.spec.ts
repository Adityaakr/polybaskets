import { Keyring } from '@polkadot/api';
import { waitReady } from '@polkadot/wasm-crypto';
import {
  SignatureVerifier,
  canonicalize,
  AgentSignedPayload,
} from './signature.verifier';

describe('SignatureVerifier', () => {
  let keyring: Keyring;
  let pair: ReturnType<Keyring['addFromUri']>;
  const verifier = new SignatureVerifier();

  beforeAll(async () => {
    await waitReady();
    keyring = new Keyring({ type: 'sr25519', ss58Format: 137 });
    pair = keyring.addFromUri('//Alice');
  });

  it('produces stable canonical bytes regardless of key order', () => {
    const a = canonicalize({ b: 1, a: 2 } as any);
    const b = canonicalize({ a: 2, b: 1 } as any);
    expect(a).toEqual(b);
  });

  it('verifies a valid signature', () => {
    const payload: AgentSignedPayload = {
      ss58: pair.address,
      action: 'register',
      label: 'alice',
      nonce: '00000000-0000-0000-0000-000000000001',
      issuedAt: 1700000000,
      expiresAt: 1700000600,
      audience: 'polybaskets.eth',
    };
    const sig = pair.sign(canonicalize(payload));
    const result = verifier.verify(payload, '0x' + Buffer.from(sig).toString('hex'));
    expect(result.ok).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const payload: AgentSignedPayload = {
      ss58: pair.address,
      action: 'register',
      label: 'alice',
      nonce: '00000000-0000-0000-0000-000000000002',
      issuedAt: 1700000000,
      expiresAt: 1700000600,
      audience: 'polybaskets.eth',
    };
    const sig = pair.sign(canonicalize(payload));
    const tampered = { ...payload, label: 'bob' };
    const result = verifier.verify(
      tampered,
      '0x' + Buffer.from(sig).toString('hex'),
    );
    expect(result.ok).toBe(false);
  });
});
