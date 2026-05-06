const REGISTRAR_BASE_URL =
  import.meta.env.VITE_AGENT_REGISTRAR_URL ??
  'https://voucher.polybaskets.com';

const PAYLOAD_KEY_ORDER = [
  'ss58',
  'action',
  'label',
  'texts',
  'metadata',
  'nonce',
  'issuedAt',
  'expiresAt',
  'audience',
] as const;

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

export interface SignedRequest {
  payload: AgentSignedPayload;
  signature: `0x${string}`;
}

export interface SubnameRecord {
  fullName: string;
  label: string;
  texts?: Record<string, string>;
  addresses?: Record<string, string>;
  metadata?: Record<string, string>;
}

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
    const v = (payload as any)[key];
    if (v !== undefined) ordered[key] = sortObject(v);
  }
  return new TextEncoder().encode(JSON.stringify(ordered));
}

export function canonicalizeHex(payload: AgentSignedPayload): `0x${string}` {
  const bytes = canonicalize(payload);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `0x${hex}`;
}

export class RegistrarError extends Error {
  constructor(public status: number, public reason: string, message?: string) {
    super(message ?? `${status} ${reason}`);
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { body?: any },
): Promise<T> {
  const url = `${REGISTRAR_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init?.headers as any) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let reason = res.statusText;
    let message: string | undefined;
    try {
      const data = await res.json();
      reason = (data?.message as string) ?? reason;
      message = data?.error;
    } catch {}
    throw new RegistrarError(res.status, reason, message);
  }
  return res.json() as Promise<T>;
}

export const registrar = {
  async register(req: SignedRequest): Promise<{ label: string }> {
    return request('/api/v1/agents/register', { method: 'POST', body: req });
  },
  async updateProfile(req: SignedRequest): Promise<{ ok: true }> {
    return request('/api/v1/agents/profile', { method: 'PATCH', body: req });
  },
  async availability(label: string): Promise<{ available: boolean; reason?: string }> {
    return request(`/api/v1/agents/availability/${encodeURIComponent(label)}`);
  },
  async byLabel(label: string): Promise<SubnameRecord | null> {
    return request(`/api/v1/agents/by-label/${encodeURIComponent(label)}`);
  },
  async byAddress(ss58: string): Promise<SubnameRecord | null> {
    return request(`/api/v1/agents/by-address/${encodeURIComponent(ss58)}`);
  },
  async byAddresses(ss58s: string[]): Promise<Record<string, SubnameRecord | null>> {
    return request('/api/v1/agents/by-addresses', {
      method: 'POST',
      body: { ss58s },
    });
  },
};
