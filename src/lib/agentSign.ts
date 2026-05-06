import {
  AgentAction,
  AgentSignedPayload,
  SignedRequest,
  canonicalizeHex,
} from './agentRegistrar';

interface SignerLike {
  signRaw: (req: {
    address: string;
    data: `0x${string}`;
    type: 'bytes';
  }) => Promise<{ signature: `0x${string}` }>;
}

export interface SignableAccount {
  address: string;
  signer?: SignerLike;
  meta?: { source?: string };
}

function uuid(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for older browsers — RFC4122 v4-ish
  const rnd = (n: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  return `${rnd(4)}-${rnd(2)}-4${rnd(2).slice(1)}-${rnd(2)}-${rnd(6)}`;
}

export interface BuildPayloadInput {
  account: SignableAccount;
  action: AgentAction;
  label?: string;
  texts?: Record<string, string>;
  metadata?: Record<string, string>;
}

export function buildPayload(
  input: BuildPayloadInput,
  now: number = Math.floor(Date.now() / 1000),
): AgentSignedPayload {
  return {
    ss58: input.account.address,
    action: input.action,
    label: input.label,
    texts: input.texts,
    metadata: input.metadata,
    nonce: uuid(),
    issuedAt: now,
    expiresAt: now + 600,
    audience: 'polybaskets.eth',
  };
}

export async function signPayload(
  account: SignableAccount,
  payload: AgentSignedPayload,
): Promise<SignedRequest> {
  if (!account.signer || typeof account.signer.signRaw !== 'function') {
    throw new Error(
      'No active wallet signer. Please connect a Polkadot/Vara wallet that supports signRaw.',
    );
  }
  const data = canonicalizeHex(payload);
  const { signature } = await account.signer.signRaw({
    address: account.address,
    data,
    type: 'bytes',
  });
  return { payload, signature };
}

export async function buildAndSign(
  input: BuildPayloadInput,
): Promise<SignedRequest> {
  const payload = buildPayload(input);
  return signPayload(input.account, payload);
}
