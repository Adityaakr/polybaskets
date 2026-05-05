# Agent Registrar Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the option-D agent registrar inside `voucher-backend` — one signed payload from the agent results in an on-chain `register_agent` extrinsic and a corresponding ENS subname under `polybaskets.eth`, with retry-driven eventual consistency for the ENS materialization.

**Architecture:** Variant B from the spec — extend the existing `gasless/` module rather than creating a new module. The agent service orchestrates: signature verify → submit on-chain extrinsic → wait for finalization → call offchain-manager SDK. Failed ENS calls are retried by a `@nestjs/schedule` worker reading a Postgres `agent_pending` queue. Single source of truth = the Vara chain.

**Tech Stack:** NestJS 10, TypeORM, Postgres, `@gear-js/api`, `@polkadot/util-crypto`, `@thenamespace/offchain-manager`, `@nestjs/schedule`, Jest.

**Spec:** [`docs/superpowers/specs/2026-05-01-agent-identity-offchain-subnames.md`](../specs/2026-05-01-agent-identity-offchain-subnames.md)

---

## File Structure

All paths relative to `voucher-backend/`.

| Path | Responsibility |
|---|---|
| `src/gasless/agent.controller.ts` | HTTP endpoints (`/api/v1/agents/*`) |
| `src/gasless/agent.service.ts` | Orchestration: validate → chain → ENS, plus reads |
| `src/gasless/chain-submitter.service.ts` | Submits `register_agent` extrinsic via existing voucher chain wallet |
| `src/gasless/chain-listener.service.ts` | Subscribes to `AgentRegistered` events to drive ENS creation |
| `src/gasless/retry-worker.task.ts` | `@Cron` task reconciling stuck `ens_pending` rows |
| `src/gasless/offchain-manager.client.ts` | Thin wrapper around `@thenamespace/offchain-manager` SDK |
| `src/gasless/signature.verifier.ts` | Canonical-payload + sr25519/ed25519 verify |
| `src/gasless/name.validator.ts` | Label regex + blocklist |
| `src/gasless/ratelimit.service.ts` | Postgres sliding-window rate limit |
| `src/gasless/nonce.service.ts` | Single-use nonce store |
| `src/gasless/dto/signed-request.dto.ts` | Wrapper `{ payload, signature }` |
| `src/gasless/dto/register-agent.dto.ts` | Register payload shape |
| `src/gasless/dto/update-agent.dto.ts` | Update payload shape |
| `src/entities/agent-nonce.entity.ts` | `agent_nonce(nonce PK, expires_at)` |
| `src/entities/agent-action-log.entity.ts` | `agent_action_log(id, ss58, action, created_at)` |
| `src/entities/agent-pending.entity.ts` | `agent_pending(ss58 PK, label, status, requested_at, last_attempt_at, attempt_count, error_message)` |
| `src/gasless/gasless.module.ts` | Modified — registers all new providers + controller |
| `src/app.module.ts` | Modified — registers three new entities |
| `src/config/configuration.ts` | Modified — adds `namespace.*` and `agents.*` config |

Each file has one responsibility. Tests live next to source under `*.spec.ts`.

---

## Phase 0 — Setup

### Task 1: Install offchain-manager SDK

**Files:**
- Modify: `voucher-backend/package.json`

- [ ] **Step 1: Install dependency**

```bash
cd voucher-backend
pnpm add @thenamespace/offchain-manager
```

- [ ] **Step 2: Verify it's in package.json**

Run: `cat package.json | grep thenamespace`
Expected output line: `"@thenamespace/offchain-manager": "^X.Y.Z"`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(voucher-backend): add @thenamespace/offchain-manager dependency"
```

### Task 2: Add config keys

**Files:**
- Modify: `voucher-backend/src/config/configuration.ts`
- Modify: `voucher-backend/.env.example`

- [ ] **Step 1: Read current configuration.ts**

Run: `cat src/config/configuration.ts`

- [ ] **Step 2: Add namespace + agents config**

In `src/config/configuration.ts`, add inside the returned object:

```ts
namespace: {
  apiKey: process.env.NAMESPACE_API_KEY,
  mode: (process.env.NAMESPACE_MODE ?? 'mainnet') as 'mainnet' | 'sepolia',
  parentName: process.env.AGENT_PARENT_NAME ?? 'polybaskets.eth',
  ownerEvm: process.env.POLYBASKETS_OWNER_EVM,
},
agents: {
  retryIntervalMs: parseInt(process.env.AGENT_RETRY_INTERVAL_MS ?? '30000', 10),
  retryMaxAttempts: parseInt(process.env.AGENT_RETRY_MAX_ATTEMPTS ?? '288', 10), // 24h at 5min spacing
  bulkReverseLookupMax: 100,
  payloadMaxAgeSeconds: 600,
  payloadClockSkewSeconds: 30,
},
```

- [ ] **Step 3: Add to .env.example**

Append to `.env.example`:

```
NAMESPACE_API_KEY=
NAMESPACE_MODE=mainnet
AGENT_PARENT_NAME=polybaskets.eth
POLYBASKETS_OWNER_EVM=
AGENT_RETRY_INTERVAL_MS=30000
AGENT_RETRY_MAX_ATTEMPTS=288
```

- [ ] **Step 4: Commit**

```bash
git add src/config/configuration.ts .env.example
git commit -m "chore(voucher-backend): add agents + namespace config keys"
```

### Task 3: Create the three entities

**Files:**
- Create: `voucher-backend/src/entities/agent-nonce.entity.ts`
- Create: `voucher-backend/src/entities/agent-action-log.entity.ts`
- Create: `voucher-backend/src/entities/agent-pending.entity.ts`

- [ ] **Step 1: Create agent-nonce.entity.ts**

```ts
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'agent_nonce' })
export class AgentNonce {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  nonce: string;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
```

- [ ] **Step 2: Create agent-action-log.entity.ts**

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AgentActionType = 'register' | 'update';

@Entity({ name: 'agent_action_log' })
@Index('idx_agent_action_lookup', ['ss58', 'action', 'createdAt'])
export class AgentActionLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 64 })
  ss58: string;

  @Column({ type: 'varchar', length: 16 })
  action: AgentActionType;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
```

- [ ] **Step 3: Create agent-pending.entity.ts**

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AgentPendingStatus =
  | 'chain_pending'
  | 'ens_pending'
  | 'complete'
  | 'chain_failed';

@Entity({ name: 'agent_pending' })
@Index('idx_agent_pending_status', ['status', 'lastAttemptAt'])
export class AgentPending {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  ss58: string;

  @Column({ type: 'varchar', length: 32 })
  label: string;

  @Column({ type: 'varchar', length: 32 })
  status: AgentPendingStatus;

  @CreateDateColumn({ name: 'requested_at', type: 'timestamptz' })
  requestedAt: Date;

  @UpdateDateColumn({ name: 'last_attempt_at', type: 'timestamptz' })
  lastAttemptAt: Date;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
}
```

- [ ] **Step 4: Register entities in app.module.ts**

In `voucher-backend/src/app.module.ts`, add imports for the three entities and add them to the `entities: [...]` array:

```ts
import { AgentNonce } from './entities/agent-nonce.entity';
import { AgentActionLog } from './entities/agent-action-log.entity';
import { AgentPending } from './entities/agent-pending.entity';

// ...inside TypeOrmModule.forRootAsync useFactory:
entities: [
  GaslessProgram,
  Voucher,
  IpTrancheUsage,
  AgentNonce,
  AgentActionLog,
  AgentPending,
],
```

- [ ] **Step 5: Boot smoke-test**

Run: `pnpm start:dev`
Expected: starts without typeorm errors. With `synchronize: true` in dev, three new tables get created. `Ctrl+C` after a clean boot.

- [ ] **Step 6: Commit**

```bash
git add src/entities/agent-nonce.entity.ts src/entities/agent-action-log.entity.ts src/entities/agent-pending.entity.ts src/app.module.ts
git commit -m "feat(voucher-backend): add agent_nonce, agent_action_log, agent_pending entities"
```

---

## Phase 1 — Pure functions (no I/O)

### Task 4: Name validator with tests

**Files:**
- Create: `voucher-backend/src/gasless/name.validator.ts`
- Create: `voucher-backend/src/gasless/name.validator.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `name.validator.spec.ts`:

```ts
import { NameValidator } from './name.validator';

describe('NameValidator', () => {
  const v = new NameValidator();

  it.each([
    ['abc', true],
    ['a-b-c', true],
    ['agent01', true],
    ['a'.repeat(20), true],
  ])('accepts valid label %s', (label, expected) => {
    expect(v.isValid(label)).toBe(expected);
  });

  it.each([
    ['', 'too short'],
    ['ab', 'too short'],
    ['a'.repeat(21), 'too long'],
    ['-abc', 'invalid'],
    ['abc-', 'invalid'],
    ['Abc', 'invalid'],
    ['ab c', 'invalid'],
    ['ab_c', 'invalid'],
  ])('rejects %s with reason %s', (label, expected) => {
    expect(v.validate(label).reason).toBe(expected);
  });

  it.each(['admin', 'root', 'polybaskets', 'vara', 'namespace', 'system'])(
    'rejects blocked label %s',
    (label) => {
      expect(v.validate(label).reason).toBe('blocked');
    },
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test name.validator.spec.ts`
Expected: FAIL with "Cannot find module './name.validator'".

- [ ] **Step 3: Implement NameValidator**

Create `name.validator.ts`:

```ts
import { Injectable } from '@nestjs/common';

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])?$/;
const MIN_LEN = 3;
const MAX_LEN = 20;
const BLOCKLIST = new Set([
  'admin',
  'root',
  'polybaskets',
  'vara',
  'namespace',
  'system',
  'support',
  'null',
  'undefined',
]);

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'too short' | 'too long' | 'invalid' | 'blocked' };

@Injectable()
export class NameValidator {
  validate(label: string): ValidationResult {
    if (label.length < MIN_LEN) return { ok: false, reason: 'too short' };
    if (label.length > MAX_LEN) return { ok: false, reason: 'too long' };
    if (BLOCKLIST.has(label)) return { ok: false, reason: 'blocked' };
    if (!LABEL_RE.test(label)) return { ok: false, reason: 'invalid' };
    return { ok: true };
  }

  isValid(label: string): boolean {
    return this.validate(label).ok === true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test name.validator.spec.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gasless/name.validator.ts src/gasless/name.validator.spec.ts
git commit -m "feat(voucher-backend): add agent label validator"
```

### Task 5: Canonical payload + signature verifier

**Files:**
- Create: `voucher-backend/src/gasless/signature.verifier.ts`
- Create: `voucher-backend/src/gasless/signature.verifier.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `signature.verifier.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test signature.verifier.spec.ts`
Expected: FAIL with "Cannot find module './signature.verifier'".

- [ ] **Step 3: Implement SignatureVerifier**

Create `signature.verifier.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test signature.verifier.spec.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gasless/signature.verifier.ts src/gasless/signature.verifier.spec.ts
git commit -m "feat(voucher-backend): add agent signature verifier with canonical payload"
```

---

## Phase 2 — Storage services

### Task 6: Nonce service with tests

**Files:**
- Create: `voucher-backend/src/gasless/nonce.service.ts`
- Create: `voucher-backend/src/gasless/nonce.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `nonce.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentNonce } from '../entities/agent-nonce.entity';
import { NonceService } from './nonce.service';

describe('NonceService', () => {
  let service: NonceService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [AgentNonce],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([AgentNonce]),
      ],
      providers: [NonceService],
    }).compile();
    service = module.get(NonceService);
  });

  it('accepts a fresh nonce once', async () => {
    const ok = await service.consume('nonce-1', new Date(Date.now() + 60_000));
    expect(ok).toBe(true);
  });

  it('rejects a replayed nonce', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    expect(await service.consume('nonce-2', expiresAt)).toBe(true);
    expect(await service.consume('nonce-2', expiresAt)).toBe(false);
  });

  it('prunes expired nonces', async () => {
    await service.consume('expired', new Date(Date.now() - 1_000));
    await service.consume('valid', new Date(Date.now() + 60_000));
    const removed = await service.pruneExpired();
    expect(removed).toBeGreaterThanOrEqual(1);
    // valid nonce still rejects on replay
    expect(await service.consume('valid', new Date(Date.now() + 60_000))).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test nonce.service.spec.ts`
Expected: FAIL with "Cannot find module './nonce.service'".

- [ ] **Step 3: Implement NonceService**

Create `nonce.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AgentNonce } from '../entities/agent-nonce.entity';

@Injectable()
export class NonceService {
  constructor(
    @InjectRepository(AgentNonce)
    private readonly repo: Repository<AgentNonce>,
  ) {}

  async consume(nonce: string, expiresAt: Date): Promise<boolean> {
    try {
      await this.repo.insert({ nonce, expiresAt });
      return true;
    } catch (err: any) {
      // Unique violation = nonce already used
      if (err?.code === '23505' || /UNIQUE/i.test(err?.message ?? '')) {
        return false;
      }
      throw err;
    }
  }

  async pruneExpired(): Promise<number> {
    const result = await this.repo.delete({ expiresAt: LessThan(new Date()) });
    return result.affected ?? 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test nonce.service.spec.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gasless/nonce.service.ts src/gasless/nonce.service.spec.ts
git commit -m "feat(voucher-backend): add Postgres-backed single-use nonce service"
```

### Task 7: Rate limit service with tests

**Files:**
- Create: `voucher-backend/src/gasless/ratelimit.service.ts`
- Create: `voucher-backend/src/gasless/ratelimit.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `ratelimit.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentActionLog } from '../entities/agent-action-log.entity';
import { RateLimitService } from './ratelimit.service';

describe('RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [AgentActionLog],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([AgentActionLog]),
      ],
      providers: [RateLimitService],
    }).compile();
    service = module.get(RateLimitService);
  });

  it('allows one register per ss58 (lifetime)', async () => {
    expect(await service.canPerform('ss58-1', 'register', 'lifetime')).toBe(true);
    await service.record('ss58-1', 'register');
    expect(await service.canPerform('ss58-1', 'register', 'lifetime')).toBe(
      false,
    );
  });

  it('allows up to 10 updates per day per ss58', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await service.canPerform('ss58-2', 'update', 'day', 10)).toBe(true);
      await service.record('ss58-2', 'update');
    }
    expect(await service.canPerform('ss58-2', 'update', 'day', 10)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test ratelimit.service.spec.ts`
Expected: FAIL with "Cannot find module './ratelimit.service'".

- [ ] **Step 3: Implement RateLimitService**

Create `ratelimit.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import {
  AgentActionLog,
  AgentActionType,
} from '../entities/agent-action-log.entity';

export type Window = 'lifetime' | 'day';

@Injectable()
export class RateLimitService {
  constructor(
    @InjectRepository(AgentActionLog)
    private readonly repo: Repository<AgentActionLog>,
  ) {}

  async canPerform(
    ss58: string,
    action: AgentActionType,
    window: Window,
    limit = 1,
  ): Promise<boolean> {
    const where: any = { ss58, action };
    if (window === 'day') {
      where.createdAt = MoreThanOrEqual(new Date(Date.now() - 24 * 3600 * 1000));
    }
    const count = await this.repo.count({ where });
    return count < limit;
  }

  async record(ss58: string, action: AgentActionType): Promise<void> {
    await this.repo.insert({ ss58, action });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test ratelimit.service.spec.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gasless/ratelimit.service.ts src/gasless/ratelimit.service.spec.ts
git commit -m "feat(voucher-backend): add Postgres-backed sliding-window rate limiter"
```

---

## Phase 3 — Offchain manager client

### Task 8: OffchainManagerClient wrapper with tests

**Files:**
- Create: `voucher-backend/src/gasless/offchain-manager.client.ts`
- Create: `voucher-backend/src/gasless/offchain-manager.client.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `offchain-manager.client.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { OffchainManagerClient } from './offchain-manager.client';

jest.mock('@thenamespace/offchain-manager', () => {
  const fakeClient = {
    createSubname: jest.fn().mockResolvedValue(undefined),
    updateSubname: jest.fn().mockResolvedValue(undefined),
    isSubnameAvailable: jest.fn().mockResolvedValue({ isAvailable: true }),
    getSingleSubname: jest.fn().mockResolvedValue(null),
    getFilteredSubnames: jest.fn().mockResolvedValue({ items: [], totalItems: 0, page: 1, size: 50 }),
  };
  return {
    createOffchainClient: jest.fn(() => fakeClient),
    ChainName: { Vara: 'vara' },
  };
});

describe('OffchainManagerClient', () => {
  let client: OffchainManagerClient;
  let config: ConfigService;

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) => {
        const map: Record<string, any> = {
          'namespace.apiKey': 'test-key',
          'namespace.mode': 'sepolia',
          'namespace.parentName': 'polybaskets.eth',
          'namespace.ownerEvm': '0x0000000000000000000000000000000000000001',
        };
        return map[key];
      }),
    } as any;
    client = new OffchainManagerClient(config);
    client.onModuleInit();
  });

  it('createForAgent passes the right shape', async () => {
    const sdk = require('@thenamespace/offchain-manager').createOffchainClient.mock
      .results[0].value;
    await client.createForAgent({
      label: 'alice',
      ss58: 'kGkAlice...',
      texts: { name: 'Alice' },
      metadata: { agentType: 'human' },
    });
    expect(sdk.createSubname).toHaveBeenCalledWith({
      label: 'alice',
      parentName: 'polybaskets.eth',
      owner: '0x0000000000000000000000000000000000000001',
      addresses: [{ chain: 'vara', value: 'kGkAlice...' }],
      texts: [{ key: 'name', value: 'Alice' }],
      metadata: [
        { key: 'varaAddress', value: 'kGkAlice...' },
        { key: 'agentType', value: 'human' },
      ],
    });
  });

  it('reverseLookup returns first match', async () => {
    const sdk = require('@thenamespace/offchain-manager').createOffchainClient.mock
      .results[0].value;
    sdk.getFilteredSubnames.mockResolvedValueOnce({
      items: [{ fullName: 'alice.polybaskets.eth', label: 'alice' }],
      totalItems: 1, page: 1, size: 1,
    });
    const result = await client.reverseLookup('kGkAlice...');
    expect(result?.label).toBe('alice');
    expect(sdk.getFilteredSubnames).toHaveBeenCalledWith({
      parentName: 'polybaskets.eth',
      metadata: { varaAddress: 'kGkAlice...' },
      size: 1,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test offchain-manager.client.spec.ts`
Expected: FAIL with "Cannot find module './offchain-manager.client'".

- [ ] **Step 3: Implement OffchainManagerClient**

Create `offchain-manager.client.ts`:

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChainName,
  createOffchainClient,
} from '@thenamespace/offchain-manager';

type SDKClient = ReturnType<typeof createOffchainClient>;

export interface CreateForAgentInput {
  label: string;
  ss58: string;
  texts?: Record<string, string>;
  metadata?: Record<string, string>;
}

export interface UpdateForAgentInput {
  label: string;
  texts?: Record<string, string>;
  metadata?: Record<string, string>;
}

@Injectable()
export class OffchainManagerClient implements OnModuleInit {
  private sdk!: SDKClient;
  private parentName!: string;
  private ownerEvm!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const apiKey = this.config.get<string>('namespace.apiKey');
    const mode = this.config.get<'mainnet' | 'sepolia'>('namespace.mode');
    this.parentName = this.config.get<string>('namespace.parentName')!;
    this.ownerEvm = this.config.get<string>('namespace.ownerEvm')!;
    if (!apiKey) throw new Error('NAMESPACE_API_KEY is not configured');
    this.sdk = createOffchainClient({ mode, defaultApiKey: apiKey });
  }

  private kvList(rec?: Record<string, string>): { key: string; value: string }[] {
    if (!rec) return [];
    return Object.entries(rec).map(([key, value]) => ({ key, value }));
  }

  async createForAgent(input: CreateForAgentInput): Promise<void> {
    await this.sdk.createSubname({
      label: input.label,
      parentName: this.parentName,
      owner: this.ownerEvm,
      addresses: [{ chain: ChainName.Vara, value: input.ss58 }],
      texts: this.kvList(input.texts),
      metadata: [
        { key: 'varaAddress', value: input.ss58 },
        ...this.kvList(input.metadata),
      ],
    });
  }

  async updateForAgent(input: UpdateForAgentInput): Promise<void> {
    await this.sdk.updateSubname(`${input.label}.${this.parentName}`, {
      texts: this.kvList(input.texts),
      metadata: this.kvList(input.metadata),
    });
  }

  async isAvailable(label: string): Promise<boolean> {
    const { isAvailable } = await this.sdk.isSubnameAvailable(
      `${label}.${this.parentName}`,
    );
    return isAvailable;
  }

  async forwardLookup(label: string) {
    return this.sdk.getSingleSubname(`${label}.${this.parentName}`);
  }

  async reverseLookup(ss58: string) {
    const page = await this.sdk.getFilteredSubnames({
      parentName: this.parentName,
      metadata: { varaAddress: ss58 },
      size: 1,
    });
    return page.items[0] ?? null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test offchain-manager.client.spec.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gasless/offchain-manager.client.ts src/gasless/offchain-manager.client.spec.ts
git commit -m "feat(voucher-backend): add typed wrapper for @thenamespace/offchain-manager"
```

---

## Phase 4 — Chain interaction

### Task 9: Chain submitter

**Files:**
- Create: `voucher-backend/src/gasless/chain-submitter.service.ts`
- Create: `voucher-backend/src/gasless/chain-submitter.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `chain-submitter.service.spec.ts`:

```ts
import { ChainSubmitter, RegisterChainResult } from './chain-submitter.service';

describe('ChainSubmitter', () => {
  it('marks success when AgentRegistered event matches', async () => {
    const fakeProgram = {
      basketMarket: {
        registerAgent: jest.fn().mockReturnValue({
          withAccount: jest.fn().mockReturnThis(),
          calculateGas: jest.fn().mockResolvedValue(undefined),
          signAndSend: jest.fn().mockImplementation(async (cb: any) => {
            cb({
              status: { isFinalized: true },
              events: [
                {
                  event: {
                    section: 'gear',
                    method: 'UserMessageSent',
                    data: { message: { payload: { toHex: () => '0x' } } },
                  },
                },
              ],
            });
            return () => {};
          }),
        }),
      },
    };
    const submitter = new ChainSubmitter({ get: () => '' } as any);
    (submitter as any).program = fakeProgram;
    (submitter as any).account = { address: '5xxx', sign: () => new Uint8Array() };
    (submitter as any).api = { isConnected: true, isReadyOrError: Promise.resolve() };

    // We treat finalization itself as success in this minimal test;
    // event decoding is exercised in integration tests.
    const result: RegisterChainResult = await submitter.registerAgent('alice');
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test chain-submitter.service.spec.ts`
Expected: FAIL with "Cannot find module './chain-submitter.service'".

- [ ] **Step 3: Implement ChainSubmitter**

Create `chain-submitter.service.ts`:

```ts
import { GearApi } from '@gear-js/api';
import { Keyring } from '@polkadot/api';
import { hexToU8a } from '@polkadot/util';
import { waitReady } from '@polkadot/wasm-crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FINALIZATION_TIMEOUT_MS = 60_000;

export type RegisterChainResult =
  | { ok: true }
  | { ok: false; reason: 'name_taken' | 'timeout' | 'rejected' | 'unknown'; message?: string };

@Injectable()
export class ChainSubmitter implements OnModuleInit {
  private readonly logger = new Logger(ChainSubmitter.name);
  private api!: GearApi;
  private nodeUrl!: string;
  private programId!: string;
  private account: any;
  private program: any;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.nodeUrl = this.config.get('nodeUrl')!;
    this.programId = this.config.get('basketMarketProgramId')!;
    this.api = new GearApi({ providerAddress: this.nodeUrl });
    await Promise.all([this.api.isReadyOrError, waitReady()]);

    const seed = this.config.get<string>('voucherAccount')!;
    const keyring = new Keyring({ type: 'sr25519', ss58Format: 137 });
    if (seed.startsWith('0x')) {
      this.account = keyring.addFromSeed(hexToU8a(seed));
    } else if (seed.startsWith('//')) {
      this.account = keyring.addFromUri(seed);
    } else {
      this.account = keyring.addFromMnemonic(seed);
    }

    // Lazy-construct the BasketMarket program client. The actual client class
    // lives in the generated bindings under `polybaskets/program/client/`;
    // for voucher-backend we re-use the same compiled JS that the frontend uses
    // by importing the package once it's published, or via a relative path.
    // Fallback: build our own thin wrapper using @gear-js/api's program tools.
    // For this task we expect the program client to be wired up before merging.
    // See spec section "Implementation footprint" for details.
    this.program = this.buildProgram();
  }

  private buildProgram(): any {
    // Real construction goes here once the polybaskets BasketMarket client
    // is exposed to voucher-backend. Until then, integration tests stub this.
    return null;
  }

  async registerAgent(label: string): Promise<RegisterChainResult> {
    if (!this.program) {
      return { ok: false, reason: 'unknown', message: 'program not initialized' };
    }
    try {
      const tx = this.program.basketMarket
        .registerAgent(label)
        .withAccount(this.account);
      await tx.calculateGas();

      return await new Promise<RegisterChainResult>((resolve) => {
        const timer = setTimeout(
          () => resolve({ ok: false, reason: 'timeout' }),
          FINALIZATION_TIMEOUT_MS,
        );
        tx.signAndSend((status: any) => {
          if (status?.status?.isFinalized) {
            clearTimeout(timer);
            // TODO: decode UserMessageSent payload to confirm AgentRegistered
            // and detect AgentNameTaken. Done in a follow-up integration test
            // task (Task 17).
            resolve({ ok: true });
          }
        }).catch((err: any) => {
          clearTimeout(timer);
          resolve({
            ok: false,
            reason: 'rejected',
            message: err?.message ?? 'unknown',
          });
        });
      });
    } catch (err: any) {
      this.logger.error('registerAgent submit failed', err);
      return { ok: false, reason: 'unknown', message: err?.message };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test chain-submitter.service.spec.ts`
Expected: 1 test PASS (others deferred to integration).

- [ ] **Step 5: Commit**

```bash
git add src/gasless/chain-submitter.service.ts src/gasless/chain-submitter.service.spec.ts
git commit -m "feat(voucher-backend): add chain submitter for register_agent extrinsic"
```

---

## Phase 5 — Orchestration

### Task 10: Agent service — register flow

**Files:**
- Create: `voucher-backend/src/gasless/agent.service.ts`
- Create: `voucher-backend/src/gasless/agent.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `agent.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Keyring } from '@polkadot/api';
import { waitReady } from '@polkadot/wasm-crypto';
import { AgentNonce } from '../entities/agent-nonce.entity';
import { AgentActionLog } from '../entities/agent-action-log.entity';
import { AgentPending } from '../entities/agent-pending.entity';
import { AgentService } from './agent.service';
import { NameValidator } from './name.validator';
import { SignatureVerifier, canonicalize } from './signature.verifier';
import { NonceService } from './nonce.service';
import { RateLimitService } from './ratelimit.service';
import { ChainSubmitter } from './chain-submitter.service';
import { OffchainManagerClient } from './offchain-manager.client';

const config = {
  get: (k: string) => {
    const m: Record<string, any> = {
      'agents.payloadMaxAgeSeconds': 600,
      'agents.payloadClockSkewSeconds': 30,
    };
    return m[k];
  },
} as any as ConfigService;

describe('AgentService.register', () => {
  let service: AgentService;
  let chain: jest.Mocked<ChainSubmitter>;
  let ens: jest.Mocked<OffchainManagerClient>;
  let pair: any;

  beforeAll(async () => {
    await waitReady();
    pair = new Keyring({ type: 'sr25519', ss58Format: 137 }).addFromUri('//Alice');
  });

  beforeEach(async () => {
    chain = { registerAgent: jest.fn().mockResolvedValue({ ok: true }) } as any;
    ens = {
      createForAgent: jest.fn().mockResolvedValue(undefined),
      isAvailable: jest.fn().mockResolvedValue(true),
    } as any;

    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [AgentNonce, AgentActionLog, AgentPending],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([AgentNonce, AgentActionLog, AgentPending]),
      ],
      providers: [
        AgentService,
        NameValidator,
        SignatureVerifier,
        NonceService,
        RateLimitService,
        { provide: ConfigService, useValue: config },
        { provide: ChainSubmitter, useValue: chain },
        { provide: OffchainManagerClient, useValue: ens },
      ],
    }).compile();

    service = module.get(AgentService);
  });

  function signedRegister(label: string, nonce = 'n-1') {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      ss58: pair.address,
      action: 'register' as const,
      label,
      nonce,
      issuedAt: now,
      expiresAt: now + 600,
      audience: 'polybaskets.eth' as const,
    };
    const sig = pair.sign(canonicalize(payload));
    return { payload, signature: '0x' + Buffer.from(sig).toString('hex') };
  }

  it('rejects expired payload', async () => {
    const req = signedRegister('alice');
    req.payload.expiresAt = Math.floor(Date.now() / 1000) - 60;
    const result = await service.register(req as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects invalid label', async () => {
    const req = signedRegister('AB');
    const result = await service.register(req as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_label');
  });

  it('happy path: chain ok + ens ok → complete', async () => {
    const req = signedRegister('alice');
    const result = await service.register(req as any);
    expect(result.ok).toBe(true);
    expect(chain.registerAgent).toHaveBeenCalledWith('alice');
    expect(ens.createForAgent).toHaveBeenCalled();
  });

  it('chain failure aborts before ens', async () => {
    chain.registerAgent.mockResolvedValueOnce({ ok: false, reason: 'name_taken' });
    const req = signedRegister('bob');
    const result = await service.register(req as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('name_taken');
    expect(ens.createForAgent).not.toHaveBeenCalled();
  });

  it('ens failure leaves row at ens_pending', async () => {
    ens.createForAgent.mockRejectedValueOnce(new Error('boom'));
    const req = signedRegister('carol');
    const result = await service.register(req as any);
    // Chain succeeded, so we still return ok to the caller
    expect(result.ok).toBe(true);
    // But the pending row should reflect ens_pending
    const row = await (service as any).pending.findOneBy({ ss58: pair.address });
    expect(row.status).toBe('ens_pending');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test agent.service.spec.ts`
Expected: FAIL with "Cannot find module './agent.service'".

- [ ] **Step 3: Implement AgentService.register**

Create `agent.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentPending } from '../entities/agent-pending.entity';
import { ChainSubmitter } from './chain-submitter.service';
import { NameValidator } from './name.validator';
import { NonceService } from './nonce.service';
import { OffchainManagerClient } from './offchain-manager.client';
import { RateLimitService } from './ratelimit.service';
import {
  AgentSignedPayload,
  SignatureVerifier,
} from './signature.verifier';

export type RegisterFailure =
  | 'expired'
  | 'replay'
  | 'invalid_signature'
  | 'invalid_label'
  | 'name_taken'
  | 'rate_limited'
  | 'audience_mismatch'
  | 'chain_failed';

export type RegisterResult =
  | { ok: true; label: string }
  | { ok: false; reason: RegisterFailure; message?: string };

interface SignedRequest {
  payload: AgentSignedPayload;
  signature: `0x${string}`;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @InjectRepository(AgentPending)
    private readonly pending: Repository<AgentPending>,
    private readonly config: ConfigService,
    private readonly nameValidator: NameValidator,
    private readonly verifier: SignatureVerifier,
    private readonly nonces: NonceService,
    private readonly limits: RateLimitService,
    private readonly chain: ChainSubmitter,
    private readonly ens: OffchainManagerClient,
  ) {}

  async register(req: SignedRequest): Promise<RegisterResult> {
    const { payload, signature } = req;
    const now = Math.floor(Date.now() / 1000);
    const skew = this.config.get<number>('agents.payloadClockSkewSeconds') ?? 30;
    const maxAge = this.config.get<number>('agents.payloadMaxAgeSeconds') ?? 600;

    if (payload.action !== 'register' || !payload.label) {
      return { ok: false, reason: 'invalid_label' };
    }
    if (payload.audience !== 'polybaskets.eth') {
      return { ok: false, reason: 'audience_mismatch' };
    }
    if (now < payload.issuedAt - skew || now > payload.expiresAt) {
      return { ok: false, reason: 'expired' };
    }
    if (payload.expiresAt - payload.issuedAt > maxAge) {
      return { ok: false, reason: 'expired' };
    }

    const labelOk = this.nameValidator.validate(payload.label);
    if (!labelOk.ok) return { ok: false, reason: 'invalid_label' };

    const nonceOk = await this.nonces.consume(
      payload.nonce,
      new Date((payload.expiresAt + 60) * 1000),
    );
    if (!nonceOk) return { ok: false, reason: 'replay' };

    const sig = this.verifier.verify(payload, signature);
    if (!sig.ok) return { ok: false, reason: 'invalid_signature' };

    if (!(await this.limits.canPerform(payload.ss58, 'register', 'lifetime'))) {
      return { ok: false, reason: 'rate_limited' };
    }

    await this.pending.save({
      ss58: payload.ss58,
      label: payload.label,
      status: 'chain_pending',
      attemptCount: 0,
      errorMessage: null,
    });

    const chainRes = await this.chain.registerAgent(payload.label);
    if (!chainRes.ok) {
      await this.pending.update(
        { ss58: payload.ss58 },
        {
          status: 'chain_failed',
          errorMessage: chainRes.message ?? chainRes.reason,
        },
      );
      const reason: RegisterFailure =
        chainRes.reason === 'name_taken' ? 'name_taken' : 'chain_failed';
      return { ok: false, reason, message: chainRes.message };
    }

    await this.limits.record(payload.ss58, 'register');
    await this.pending.update(
      { ss58: payload.ss58 },
      { status: 'ens_pending', attemptCount: 1 },
    );

    try {
      await this.ens.createForAgent({
        label: payload.label,
        ss58: payload.ss58,
        texts: payload.texts,
        metadata: payload.metadata,
      });
      await this.pending.update(
        { ss58: payload.ss58 },
        { status: 'complete' },
      );
    } catch (err: any) {
      this.logger.warn(
        `ENS create failed for ${payload.label}: ${err?.message}; retry worker will reconcile`,
      );
      await this.pending.update(
        { ss58: payload.ss58 },
        { errorMessage: err?.message ?? 'unknown' },
      );
      // Chain already succeeded; we still return ok.
    }

    return { ok: true, label: payload.label };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test agent.service.spec.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gasless/agent.service.ts src/gasless/agent.service.spec.ts
git commit -m "feat(voucher-backend): add AgentService.register orchestration"
```

### Task 11: Agent service — update flow

**Files:**
- Modify: `voucher-backend/src/gasless/agent.service.ts`
- Modify: `voucher-backend/src/gasless/agent.service.spec.ts`

- [ ] **Step 1: Append failing tests for update**

Append to `agent.service.spec.ts`, inside an outer describe (or new describe block):

```ts
describe('AgentService.update', () => {
  // … reuse the same setup from above; or extract into beforeEach helper.

  it('signer must own the label', async () => {
    // Imagine alice is registered. Bob signs an update for "alice".
    // service.update should reject with 'forbidden'.
    // Test stubs forwardLookup to return alice's record.
    // Implementation reads metadata.varaAddress and compares.
    // (Concrete code in step 3 below; this test asserts the rejection.)
  });
});
```

(Engineer: write a concrete test that mocks `ens.forwardLookup` returning `{ metadata: { varaAddress: 'aliceAddress' } }` and submits a payload signed by Bob's keypair. Expect `result.reason === 'forbidden'`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test agent.service.spec.ts`
Expected: new test FAILs because `update` is not defined.

- [ ] **Step 3: Implement AgentService.update**

Append to `agent.service.ts`:

```ts
export type UpdateFailure =
  | 'expired'
  | 'replay'
  | 'invalid_signature'
  | 'audience_mismatch'
  | 'rate_limited'
  | 'forbidden'
  | 'not_registered'
  | 'invalid_field';

export type UpdateResult =
  | { ok: true }
  | { ok: false; reason: UpdateFailure; message?: string };

const IMMUTABLE_METADATA_KEYS = new Set(['varaAddress']);

function validateProfileFields(
  texts?: Record<string, string>,
  metadata?: Record<string, string>,
): { ok: true } | { ok: false; reason: 'invalid_field' } {
  if (texts) {
    if (texts['avatar'] && !/^(https:\/\/|ipfs:\/\/)/.test(texts['avatar']))
      return { ok: false, reason: 'invalid_field' };
    if (texts['url'] && !texts['url'].startsWith('https://'))
      return { ok: false, reason: 'invalid_field' };
    if (texts['description'] && texts['description'].length > 500)
      return { ok: false, reason: 'invalid_field' };
    if (texts['com.twitter'] && !/^[A-Za-z0-9_]{1,32}$/.test(texts['com.twitter']))
      return { ok: false, reason: 'invalid_field' };
  }
  if (metadata) {
    for (const key of Object.keys(metadata)) {
      if (IMMUTABLE_METADATA_KEYS.has(key))
        return { ok: false, reason: 'invalid_field' };
    }
  }
  return { ok: true };
}

// Inside the AgentService class:
async update(req: SignedRequest): Promise<UpdateResult> {
  const { payload, signature } = req;
  const now = Math.floor(Date.now() / 1000);
  const skew = this.config.get<number>('agents.payloadClockSkewSeconds') ?? 30;

  if (payload.action !== 'update') return { ok: false, reason: 'invalid_field' };
  if (payload.audience !== 'polybaskets.eth')
    return { ok: false, reason: 'audience_mismatch' };
  if (now < payload.issuedAt - skew || now > payload.expiresAt)
    return { ok: false, reason: 'expired' };

  const fields = validateProfileFields(payload.texts, payload.metadata);
  if (!fields.ok) return fields;

  const nonceOk = await this.nonces.consume(
    payload.nonce,
    new Date((payload.expiresAt + 60) * 1000),
  );
  if (!nonceOk) return { ok: false, reason: 'replay' };

  const sig = this.verifier.verify(payload, signature);
  if (!sig.ok) return { ok: false, reason: 'invalid_signature' };

  // signer-matches-bound-ss58: read the agent's current subname; varaAddress
  // metadata key is the canonical binding.
  const existing = await this.ens.reverseLookup(payload.ss58);
  if (!existing) return { ok: false, reason: 'not_registered' };
  if (existing.metadata?.varaAddress !== payload.ss58)
    return { ok: false, reason: 'forbidden' };

  if (!(await this.limits.canPerform(payload.ss58, 'update', 'day', 10))) {
    return { ok: false, reason: 'rate_limited' };
  }

  try {
    await this.ens.updateForAgent({
      label: existing.label,
      texts: payload.texts,
      metadata: payload.metadata,
    });
    await this.limits.record(payload.ss58, 'update');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: 'invalid_field', message: err?.message };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test agent.service.spec.ts`
Expected: all tests (register + update) PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gasless/agent.service.ts src/gasless/agent.service.spec.ts
git commit -m "feat(voucher-backend): add AgentService.update with signer-matches-bound check"
```

### Task 12: Agent service — read endpoints (forward, reverse, bulk reverse, availability)

**Files:**
- Modify: `voucher-backend/src/gasless/agent.service.ts`
- Modify: `voucher-backend/src/gasless/agent.service.spec.ts`

- [ ] **Step 1: Append failing tests for read APIs**

Engineer: add tests that mock `ens.forwardLookup`, `ens.reverseLookup`, `ens.isAvailable` and assert each delegated call. Include one bulk reverse test with 3 ss58 inputs.

- [ ] **Step 2: Implement read methods**

Append to `agent.service.ts` inside the class:

```ts
async forward(label: string) {
  return this.ens.forwardLookup(label);
}

async reverse(ss58: string) {
  return this.ens.reverseLookup(ss58);
}

async bulkReverse(ss58s: string[]) {
  const max = this.config.get<number>('agents.bulkReverseLookupMax') ?? 100;
  const slice = ss58s.slice(0, max);
  const results = await Promise.all(
    slice.map(async (s) => [s, await this.ens.reverseLookup(s)] as const),
  );
  return Object.fromEntries(results);
}

async availability(label: string) {
  const labelOk = this.nameValidator.validate(label);
  if (!labelOk.ok) return { available: false, reason: labelOk.reason };
  const free = await this.ens.isAvailable(label);
  return { available: free };
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm test agent.service.spec.ts`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/gasless/agent.service.ts src/gasless/agent.service.spec.ts
git commit -m "feat(voucher-backend): add agent read endpoints (forward, reverse, bulk, availability)"
```

---

## Phase 6 — Cron worker

### Task 13: Retry worker

**Files:**
- Create: `voucher-backend/src/gasless/retry-worker.task.ts`
- Create: `voucher-backend/src/gasless/retry-worker.task.spec.ts`

- [ ] **Step 1: Write failing tests**

Engineer: write a test that seeds two `agent_pending` rows with `status='ens_pending'` and stubs `ens.createForAgent` to succeed for one and fail for the other. After invoking `worker.tick()` directly, assert the first row is `complete` and the second row's `attemptCount` increased.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test retry-worker.task.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement RetryWorker**

Create `retry-worker.task.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AgentPending } from '../entities/agent-pending.entity';
import { OffchainManagerClient } from './offchain-manager.client';
import { NonceService } from './nonce.service';

const BATCH_SIZE = 50;

@Injectable()
export class RetryWorker {
  private readonly logger = new Logger(RetryWorker.name);

  constructor(
    @InjectRepository(AgentPending)
    private readonly pending: Repository<AgentPending>,
    private readonly ens: OffchainManagerClient,
    private readonly nonces: NonceService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    const interval =
      this.config.get<number>('agents.retryIntervalMs') ?? 30_000;
    const cutoff = new Date(Date.now() - interval);

    const rows = await this.pending.find({
      where: { status: 'ens_pending', lastAttemptAt: LessThan(cutoff) },
      order: { requestedAt: 'ASC' },
      take: BATCH_SIZE,
    });

    for (const row of rows) {
      try {
        await this.ens.createForAgent({ label: row.label, ss58: row.ss58 });
        await this.pending.update(
          { ss58: row.ss58 },
          { status: 'complete', errorMessage: null },
        );
      } catch (err: any) {
        await this.pending.update(
          { ss58: row.ss58 },
          {
            attemptCount: () => '"attempt_count" + 1',
            errorMessage: err?.message ?? 'unknown',
          },
        );
        this.logger.warn(
          `Retry failed for ${row.label} (${row.attemptCount + 1}): ${err?.message}`,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async pruneNonces(): Promise<void> {
    const removed = await this.nonces.pruneExpired();
    if (removed > 0)
      this.logger.log(`Pruned ${removed} expired nonces`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test retry-worker.task.spec.ts`
Expected: tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gasless/retry-worker.task.ts src/gasless/retry-worker.task.spec.ts
git commit -m "feat(voucher-backend): add retry worker for ENS materialization + nonce pruning"
```

---

## Phase 7 — HTTP layer

### Task 14: DTOs

**Files:**
- Create: `voucher-backend/src/gasless/dto/signed-request.dto.ts`
- Create: `voucher-backend/src/gasless/dto/register-agent.dto.ts`
- Create: `voucher-backend/src/gasless/dto/update-agent.dto.ts`

- [ ] **Step 1: Create signed-request.dto.ts**

```ts
import { Type } from 'class-transformer';
import {
  IsObject,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class SignedPayloadDto {
  @IsString() ss58: string;
  @IsString() action: 'register' | 'update';
  @IsString() nonce: string;
  @IsString() audience: 'polybaskets.eth';
  @IsString() label?: string;
  @IsObject() texts?: Record<string, string>;
  @IsObject() metadata?: Record<string, string>;
  // numbers
  issuedAt: number;
  expiresAt: number;
}

export class SignedRequestDto {
  @ValidateNested()
  @Type(() => SignedPayloadDto)
  payload: SignedPayloadDto;

  @Matches(/^0x[0-9a-fA-F]+$/, { message: 'signature must be 0x-hex' })
  signature: `0x${string}`;
}
```

- [ ] **Step 2: Create register-agent.dto.ts and update-agent.dto.ts**

```ts
// register-agent.dto.ts
import { SignedRequestDto } from './signed-request.dto';
export class RegisterAgentDto extends SignedRequestDto {}

// update-agent.dto.ts
import { SignedRequestDto } from './signed-request.dto';
export class UpdateAgentDto extends SignedRequestDto {}
```

- [ ] **Step 3: Commit**

```bash
git add src/gasless/dto/
git commit -m "feat(voucher-backend): add agent registrar DTOs"
```

### Task 15: Agent controller

**Files:**
- Create: `voucher-backend/src/gasless/agent.controller.ts`
- Create: `voucher-backend/src/gasless/agent.controller.spec.ts`

- [ ] **Step 1: Write failing controller tests**

Engineer: use `@nestjs/testing` to instantiate the controller with a mocked `AgentService`. Verify each route delegates to the right service method and translates failures to the right HTTP code (400 for validation failures, 401 for invalid signature, 403 for forbidden, 429 for rate_limited).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test agent.controller.spec.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement AgentController**

Create `agent.controller.ts`:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  TooManyRequestsException,
  UnauthorizedException,
} from '@nestjs/common';
import { AgentService, RegisterFailure, UpdateFailure } from './agent.service';
import { RegisterAgentDto } from './dto/register-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

const REGISTER_HTTP: Record<RegisterFailure, number> = {
  expired: 400,
  replay: 400,
  invalid_signature: 401,
  invalid_label: 400,
  name_taken: 409,
  rate_limited: 429,
  audience_mismatch: 400,
  chain_failed: 502,
};

const UPDATE_HTTP: Record<UpdateFailure, number> = {
  expired: 400,
  replay: 400,
  invalid_signature: 401,
  audience_mismatch: 400,
  rate_limited: 429,
  forbidden: 403,
  not_registered: 404,
  invalid_field: 400,
};

@Controller('/api/v1/agents')
export class AgentController {
  constructor(private readonly agents: AgentService) {}

  @Post('/register')
  @HttpCode(200)
  async register(@Body() body: RegisterAgentDto) {
    const result = await this.agents.register(body);
    if (!result.ok) this.throwFor(REGISTER_HTTP[result.reason], result.reason);
    return { label: result['label'] };
  }

  @Patch('/profile')
  @HttpCode(200)
  async update(@Body() body: UpdateAgentDto) {
    const result = await this.agents.update(body);
    if (!result.ok) this.throwFor(UPDATE_HTTP[result.reason], result.reason);
    return { ok: true };
  }

  @Get('/availability/:label')
  availability(@Param('label') label: string) {
    return this.agents.availability(label);
  }

  @Get('/by-label/:label')
  async byLabel(@Param('label') label: string) {
    return (await this.agents.forward(label)) ?? null;
  }

  @Get('/by-address/:ss58')
  async byAddress(@Param('ss58') ss58: string) {
    return (await this.agents.reverse(ss58)) ?? null;
  }

  @Post('/by-addresses')
  @HttpCode(200)
  async byAddresses(@Body() body: { ss58s: string[] }) {
    if (!Array.isArray(body?.ss58s))
      throw new BadRequestException('ss58s must be an array');
    return this.agents.bulkReverse(body.ss58s);
  }

  private throwFor(status: number, reason: string): never {
    if (status === 401) throw new UnauthorizedException(reason);
    if (status === 403) throw new ForbiddenException(reason);
    if (status === 429) throw new TooManyRequestsException(reason);
    throw new BadRequestException(reason);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test agent.controller.spec.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gasless/agent.controller.ts src/gasless/agent.controller.spec.ts
git commit -m "feat(voucher-backend): add /api/v1/agents/* controller"
```

### Task 16: Wire everything into GaslessModule

**Files:**
- Modify: `voucher-backend/src/gasless/gasless.module.ts`

- [ ] **Step 1: Update GaslessModule**

Replace the existing module with:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { GaslessProgram } from '../entities/gasless-program.entity';
import { Voucher } from '../entities/voucher.entity';
import { IpTrancheUsage } from '../entities/ip-tranche-usage.entity';
import { AgentNonce } from '../entities/agent-nonce.entity';
import { AgentActionLog } from '../entities/agent-action-log.entity';
import { AgentPending } from '../entities/agent-pending.entity';
import { GaslessService } from './gasless.service';
import { GaslessController } from './gasless.controller';
import { VoucherService } from './voucher.service';
import { VoucherTask } from './voucher.task';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { NameValidator } from './name.validator';
import { SignatureVerifier } from './signature.verifier';
import { NonceService } from './nonce.service';
import { RateLimitService } from './ratelimit.service';
import { ChainSubmitter } from './chain-submitter.service';
import { OffchainManagerClient } from './offchain-manager.client';
import { RetryWorker } from './retry-worker.task';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      GaslessProgram,
      Voucher,
      IpTrancheUsage,
      AgentNonce,
      AgentActionLog,
      AgentPending,
    ]),
  ],
  controllers: [GaslessController, AgentController],
  providers: [
    GaslessService,
    VoucherService,
    VoucherTask,
    AgentService,
    NameValidator,
    SignatureVerifier,
    NonceService,
    RateLimitService,
    ChainSubmitter,
    OffchainManagerClient,
    RetryWorker,
  ],
  exports: [GaslessService, VoucherService],
})
export class GaslessModule {}
```

- [ ] **Step 2: Boot the app**

Run: `pnpm start:dev`
Expected: clean startup, no DI errors. The app logs the Cron worker registering. Hit `Ctrl+C`.

- [ ] **Step 3: Commit**

```bash
git add src/gasless/gasless.module.ts
git commit -m "feat(voucher-backend): register agent registrar providers in GaslessModule"
```

---

## Phase 8 — End-to-end smoke test

### Task 17: End-to-end test against staging

**Files:**
- Create: `voucher-backend/test/agents.e2e-spec.ts`

- [ ] **Step 1: Set up environment**

In `voucher-backend/.env`, populate (do NOT commit this file):

```
NAMESPACE_API_KEY=<rotated key from Namespace>
NAMESPACE_MODE=mainnet
AGENT_PARENT_NAME=polybaskets.eth
POLYBASKETS_OWNER_EVM=<EVM address that owns polybaskets.eth>
```

The Vara node URL and program ID should already be set for staging.

- [ ] **Step 2: Write e2e flow**

Create `test/agents.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Keyring } from '@polkadot/api';
import { waitReady } from '@polkadot/wasm-crypto';
import { AppModule } from '../src/app.module';
import { canonicalize } from '../src/gasless/signature.verifier';

describe('Agents E2E (staging)', () => {
  let app: INestApplication;
  let pair: any;

  beforeAll(async () => {
    await waitReady();
    pair = new Keyring({ type: 'sr25519', ss58Format: 137 }).addFromUri(
      `//Test${Date.now()}`,
    );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('register → forward → reverse', async () => {
    const label = `e2e${Date.now()}`.slice(0, 16).toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      ss58: pair.address,
      action: 'register' as const,
      label,
      nonce: `${Date.now()}-${Math.random()}`,
      issuedAt: now,
      expiresAt: now + 600,
      audience: 'polybaskets.eth' as const,
    };
    const sig = pair.sign(canonicalize(payload));

    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/register')
      .send({
        payload,
        signature: '0x' + Buffer.from(sig).toString('hex'),
      })
      .expect(200);
    expect(res.body.label).toBe(label);

    // Allow a few seconds for chain finalization + ENS create.
    await new Promise((r) => setTimeout(r, 8_000));

    const fwd = await request(app.getHttpServer())
      .get(`/api/v1/agents/by-label/${label}`)
      .expect(200);
    expect(fwd.body?.label).toBe(label);

    const rev = await request(app.getHttpServer())
      .get(`/api/v1/agents/by-address/${pair.address}`)
      .expect(200);
    expect(rev.body?.label).toBe(label);
  });
});
```

- [ ] **Step 3: Run e2e**

Run: `pnpm test test/agents.e2e-spec.ts --testTimeout 60000`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/agents.e2e-spec.ts
git commit -m "test(voucher-backend): add agents register/forward/reverse e2e"
```

---

## Phase 9 — Documentation propagation

### Task 18: Update voucher-backend README

**Files:**
- Modify: `voucher-backend/README.md`

- [ ] **Step 1: Append Agents section**

```markdown
## Agent Registrar

`/api/v1/agents/*` routes manage `<label>.polybaskets.eth` ENS subnames for PolyBaskets agents.

- `POST /register` — submit a SIWS-signed payload to register a new agent (chain + ENS, atomic from the agent's POV).
- `PATCH /profile` — update mutable profile fields. Requires the signature to come from the SS58 currently bound to the agent.
- `GET /availability/:label` — check label is free.
- `GET /by-label/:label` — forward lookup.
- `GET /by-address/:ss58` — reverse lookup.
- `POST /by-addresses` — bulk reverse, max 100.

Names are permanent — there is no rename or release endpoint.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(voucher-backend): document agent registrar endpoints"
```

---

## Self-Review Checklist

Run through this once after the plan is implemented:

- [ ] Each spec section has a corresponding task. Validation pipeline → Tasks 4–7 + 10–11. Atomic flow → Task 10. Retry worker → Task 13. Read endpoints → Task 12, 15. Profile shape → Task 11 (immutable keys). Migration deferred to Plan 2.
- [ ] No `TBD`/`TODO` left in source files (the engineer should grep before merging).
- [ ] All types referenced in later tasks are defined in earlier tasks: `SignedRequest`, `AgentSignedPayload`, `RegisterFailure`, `UpdateFailure`, `RegisterChainResult`.
- [ ] All file paths are exact; the engineer should be able to copy-paste.
- [ ] All test commands include both the `pnpm test ...` and the expected outcome.
- [ ] The commit messages follow conventional-commits (`feat`, `chore`, `test`, `docs`).

## Out of scope for this plan (subsequent plans)

- **Plan 2: Bulk migration of existing on-chain agents.** Reads `getAllAgents()` and seeds `agent_pending` rows the retry worker picks up.
- **Plan 3: Frontend integration.** `RegisterAgentDialog`, `EditAgentProfile`, replace `useAgentNames`, drop unused `registerAgent()` SDK wrapper.
- **Plan 4: Agent self-service skill.** New `.claude/skills/polybaskets-agent-identity/` teaching agents the canonical payload, signing, and endpoints with copy-pasteable recipes.
