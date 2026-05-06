# Agent ENS Subname Registrar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a verify-only NestJS module to `voucher-backend/` that creates ENS subnames under `polybaskets.eth` for agents already registered on-chain in `BasketMarket`, with optional ENSIP-compliant profile fields and a periodic reconciler that mops up missing subnames.

**Architecture:** Self-contained `agent-registrar/` module in `voucher-backend/src/`. New module imports `ConfigModule` only; touches no existing code paths in `gasless/`. Reads on-chain state via a fresh `GearApi` connection; writes ENS via `@thenamespace/offchain-manager` SDK with the API key held server-side. One `POST /agent/register` (verify on-chain → create subname), one `PATCH /agent/profile` (verify on-chain name match → update records), one `GET /agent/profile/:account` (read-through cache). A `@Cron` job + a `MIGRATION_ENABLED`-gated one-shot share a single `reconcileAgents()` function. STARTER_PROMPT.md gets a minimal augment to its existing Step 3 — keep the on-chain `RegisterAgent` call (only the agent can sign), append a follow-up `POST /agent/register`.

**Tech Stack:** NestJS 10, TypeScript 5, `@thenamespace/offchain-manager`, `@gear-js/api` 0.39, `class-validator`, `@nestjs/schedule`, Jest 30 + ts-jest.

**Spec:** `docs/superpowers/specs/2026-05-06-agent-ens-subname-design.md`.

---

## Working directory note

All paths below are relative to `voucher-backend/` unless otherwise stated. Run `cd voucher-backend` before any `npm`, `npx`, or `jest` command. Frontend path edits in the STARTER_PROMPT task happen at the repo root.

---

## Task 1: Install SDK and scaffold the module

**Files:**
- Modify: `voucher-backend/package.json`
- Create: `voucher-backend/src/agent-registrar/agent-registrar.module.ts`
- Modify: `voucher-backend/src/app.module.ts`

- [ ] **Step 1: Install the Namespace SDK**

Run:

```bash
cd voucher-backend
npm install @thenamespace/offchain-manager
```

Expected: `package.json` and `package-lock.json` updated, no peer-dep warnings that block install.

- [ ] **Step 2: Create empty module file**

Create `voucher-backend/src/agent-registrar/agent-registrar.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class AgentRegistrarModule {}
```

- [ ] **Step 3: Wire module into `AppModule`**

In `voucher-backend/src/app.module.ts`, add the import line near the other module imports:

```typescript
import { AgentRegistrarModule } from './agent-registrar/agent-registrar.module';
```

And add `AgentRegistrarModule` to the `imports` array of the `@Module` decorator (alphabetical order with the existing `GaslessModule` is fine — place it just before `GaslessModule`).

- [ ] **Step 4: Verify boot still works**

Run:

```bash
cd voucher-backend
npm run build
```

Expected: build succeeds with no TypeScript errors. (`npm run start:dev` is not required here — the build alone proves the wiring compiles.)

- [ ] **Step 5: Commit**

```bash
git add voucher-backend/package.json voucher-backend/package-lock.json voucher-backend/src/agent-registrar/agent-registrar.module.ts voucher-backend/src/app.module.ts
git commit -m "feat(agent-registrar): scaffold module with SDK dependency"
```

---

## Task 2: Configuration entries for agent-registrar

**Files:**
- Modify: `voucher-backend/src/config/configuration.ts`

The .env already contains `NAMESPACE_API_KEY`, `NAMESPACE_MODE`, `AGENT_PARENT_NAME`, `POLYBASKETS_OWNER_EVM`, `AGENT_RETRY_INTERVAL_MS`, `AGENT_RETRY_MAX_ATTEMPTS`, `MIGRATION_ENABLED`, and `BASKET_MARKET_PROGRAM_ID`. We surface them through `ConfigService` with the same fail-fast validation pattern as the existing voucher knobs.

- [ ] **Step 1: Write the failing test**

Create `voucher-backend/src/config/configuration.spec.ts`:

```typescript
import configuration from './configuration';

describe('agent-registrar configuration', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function setRequiredVoucherEnv(): void {
    process.env.DB_USER = 'u';
    process.env.DB_PASSWORD = 'p';
    process.env.DB_NAME = 'n';
    process.env.NODE_URL = 'wss://x';
    process.env.VOUCHER_ACCOUNT = '//Alice';
  }

  it('exposes namespace + agent registrar values', () => {
    setRequiredVoucherEnv();
    process.env.NAMESPACE_API_KEY = 'ns-test';
    process.env.NAMESPACE_MODE = 'sepolia';
    process.env.AGENT_PARENT_NAME = 'polybaskets.eth';
    process.env.POLYBASKETS_OWNER_EVM = '0xabc';
    process.env.BASKET_MARKET_PROGRAM_ID = '0xdef';
    process.env.AGENT_RETRY_INTERVAL_MS = '30000';
    process.env.AGENT_RETRY_MAX_ATTEMPTS = '288';
    process.env.MIGRATION_ENABLED = 'true';

    const cfg = configuration() as any;

    expect(cfg.agentRegistrar).toEqual({
      namespaceApiKey: 'ns-test',
      namespaceMode: 'sepolia',
      parentName: 'polybaskets.eth',
      ownerEvm: '0xabc',
      basketMarketProgramId: '0xdef',
      retryIntervalMs: 30000,
      retryMaxAttempts: 288,
      migrationEnabled: true,
    });
  });

  it('defaults migrationEnabled to false', () => {
    setRequiredVoucherEnv();
    process.env.NAMESPACE_API_KEY = 'k';
    process.env.NAMESPACE_MODE = 'mainnet';
    process.env.AGENT_PARENT_NAME = 'polybaskets.eth';
    process.env.POLYBASKETS_OWNER_EVM = '0x0';
    process.env.BASKET_MARKET_PROGRAM_ID = '0x0';
    delete process.env.MIGRATION_ENABLED;

    const cfg = configuration() as any;
    expect(cfg.agentRegistrar.migrationEnabled).toBe(false);
  });

  it('rejects invalid namespace mode', () => {
    setRequiredVoucherEnv();
    process.env.NAMESPACE_API_KEY = 'k';
    process.env.NAMESPACE_MODE = 'bogus';
    process.env.AGENT_PARENT_NAME = 'p.eth';
    process.env.POLYBASKETS_OWNER_EVM = '0x0';
    process.env.BASKET_MARKET_PROGRAM_ID = '0x0';

    expect(() => configuration()).toThrow(/NAMESPACE_MODE/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd voucher-backend && npx jest src/config/configuration.spec.ts -i`
Expected: FAIL — `cfg.agentRegistrar` is undefined / property errors.

- [ ] **Step 3: Implement config entries**

In `voucher-backend/src/config/configuration.ts`, add the helpers and the new section. Append before the closing `};` of the returned object:

```typescript
const oneOf = (name: string, allowed: readonly string[]): string => {
  const raw = required(name);
  if (!allowed.includes(raw)) {
    throw new Error(
      `${name} must be one of [${allowed.join(', ')}] (got "${raw}")`,
    );
  }
  return raw;
};

const bool = (name: string, defaultValue: boolean): boolean => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`${name} must be "true" or "false" (got "${raw}")`);
};
```

Place these near the top of the file alongside `posInt` / `nonNegInt`. Then, in the returned object literal, add:

```typescript
    agentRegistrar: {
      namespaceApiKey: required('NAMESPACE_API_KEY'),
      namespaceMode: oneOf('NAMESPACE_MODE', ['mainnet', 'sepolia']),
      parentName: required('AGENT_PARENT_NAME'),
      ownerEvm: required('POLYBASKETS_OWNER_EVM'),
      basketMarketProgramId: required('BASKET_MARKET_PROGRAM_ID'),
      retryIntervalMs: posInt('AGENT_RETRY_INTERVAL_MS', '30000'),
      retryMaxAttempts: posInt('AGENT_RETRY_MAX_ATTEMPTS', '288'),
      migrationEnabled: bool('MIGRATION_ENABLED', false),
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd voucher-backend && npx jest src/config/configuration.spec.ts -i`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add voucher-backend/src/config/configuration.ts voucher-backend/src/config/configuration.spec.ts
git commit -m "feat(config): expose agent-registrar settings via ConfigService"
```

---

## Task 3: DTOs (request validation)

**Files:**
- Create: `voucher-backend/src/agent-registrar/dto/register-agent.dto.ts`
- Create: `voucher-backend/src/agent-registrar/dto/update-profile.dto.ts`
- Create: `voucher-backend/src/agent-registrar/dto/profile.dto.ts`
- Create: `voucher-backend/src/agent-registrar/dto/register-agent.dto.spec.ts`

DTOs intentionally accept arbitrary text/address keys — vocabulary is not enforced at the API layer (per spec: "supports any and everything"). Format-only validation: key length, character class, value length.

- [ ] **Step 1: Write the failing test**

Create `voucher-backend/src/agent-registrar/dto/register-agent.dto.spec.ts`:

```typescript
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterAgentDto } from './register-agent.dto';

async function validateDto(payload: unknown): Promise<string[]> {
  const dto = plainToInstance(RegisterAgentDto, payload);
  const errors = await validate(dto as object, { whitelist: true });
  return errors.flatMap((e) =>
    Object.values(e.constraints ?? {}).concat(
      (e.children ?? []).flatMap((c) => Object.values(c.constraints ?? {})),
    ),
  );
}

describe('RegisterAgentDto', () => {
  it('accepts a minimal payload', async () => {
    const errors = await validateDto({
      account: '0x' + 'a'.repeat(64),
      name: 'happy',
    });
    expect(errors).toEqual([]);
  });

  it('accepts a full profile', async () => {
    const errors = await validateDto({
      account: '0x' + 'a'.repeat(64),
      name: 'happy-bot',
      profile: {
        texts: {
          description: 'lots of fun',
          'com.twitter': 'happys1ngh',
        },
        addresses: [{ chain: 'Ethereum', value: '0x1234' }],
        ethAddress: '0xdead',
      },
    });
    expect(errors).toEqual([]);
  });

  it('rejects bad name characters', async () => {
    const errors = await validateDto({
      account: '0x' + 'a'.repeat(64),
      name: 'BadName',
    });
    expect(errors.join(' ')).toMatch(/lowercase/i);
  });

  it('rejects too short name', async () => {
    const errors = await validateDto({
      account: '0x' + 'a'.repeat(64),
      name: 'ab',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects too long name', async () => {
    const errors = await validateDto({
      account: '0x' + 'a'.repeat(64),
      name: 'a'.repeat(21),
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects malformed account', async () => {
    const errors = await validateDto({ account: 'nope', name: 'happy' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd voucher-backend && npx jest src/agent-registrar/dto -i`
Expected: FAIL — module `./register-agent.dto` not found.

- [ ] **Step 3: Implement `ProfileDto`**

Create `voucher-backend/src/agent-registrar/dto/profile.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ProfileAddressDto {
  @IsString()
  @MaxLength(64)
  chain: string;

  @IsString()
  @MaxLength(256)
  value: string;
}

export class ProfileDto {
  /**
   * ENSIP-5 text records, free-form. Keys: 1–64 chars, [a-zA-Z0-9._-].
   * Values: up to 4096 chars; explicit `null` deletes the key.
   *
   * Format-only validation. Vocabulary is intentionally not enforced — agents
   * can use any ENSIP-5 standard key (description, avatar, url) or namespaced
   * social key (com.twitter, com.github). The recommended set is surfaced in
   * STARTER_PROMPT.md.
   */
  @IsOptional()
  @IsObject()
  texts?: Record<string, string | null>;

  /** ENSIP-9 multichain addresses (chain name + value). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProfileAddressDto)
  addresses?: ProfileAddressDto[];

  /**
   * Convenience for the most common case — surfaced in STARTER_PROMPT so an
   * agent can supply its EVM address without learning the addresses[] shape.
   * Mapped into addresses[] as { chain: 'Ethereum', value } during processing.
   */
  @IsOptional()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, { message: 'ethAddress must be 0x + 40 hex' })
  ethAddress?: string;
}
```

- [ ] **Step 4: Implement `RegisterAgentDto`**

Create `voucher-backend/src/agent-registrar/dto/register-agent.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProfileDto } from './profile.dto';

export class RegisterAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(66)
  account: string;

  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'name must be lowercase letters, digits, hyphens (3-20 chars)',
  })
  name: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileDto)
  profile?: ProfileDto;
}
```

- [ ] **Step 5: Implement `UpdateProfileDto`**

Create `voucher-backend/src/agent-registrar/dto/update-profile.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ProfileDto } from './profile.dto';

export class UpdateProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(66)
  account: string;

  @ValidateNested()
  @Type(() => ProfileDto)
  profile: ProfileDto;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd voucher-backend && npx jest src/agent-registrar/dto -i`
Expected: PASS, all six cases.

- [ ] **Step 7: Commit**

```bash
git add voucher-backend/src/agent-registrar/dto
git commit -m "feat(agent-registrar): add request DTOs with ENSIP-aware profile shape"
```

---

## Task 4: Vara on-chain reader (`vara-agent.reader.ts`)

**Files:**
- Create: `voucher-backend/src/agent-registrar/vara-agent.reader.ts`
- Create: `voucher-backend/src/agent-registrar/vara-agent.reader.spec.ts`

Read-only adapter: connects a `GearApi` to `NODE_URL`, instantiates the `BasketMarket` Sails program from `src/basket-market-client/lib.ts`, exposes `getAgent(account)` and `getAllAgents()`. Reconnect-on-disconnect mirroring `voucher.service.ts`.

- [ ] **Step 1: Confirm we can import the Sails client from voucher-backend**

Run:

```bash
cd voucher-backend
ls -la node_modules/sails-js 2>/dev/null || true
ls ../src/basket-market-client/
```

Expected: `lib.ts`, `global.d.ts` exist at `../src/basket-market-client/`. The frontend's `basket-market-client` lib references `sails-js`. We will copy the minimum needed types/program into the backend rather than reaching into the frontend tree.

- [ ] **Step 2: Vendor a minimal `BasketMarket` reader (no shared imports)**

Read `src/basket-market-client/lib.ts` (frontend) once to extract the exact type of `AgentInfo` returned by `getAgent`/`getAllAgents`. Then create the reader as a hand-written wrapper using `@gear-js/api`'s low-level RPC, avoiding a cross-package import. The shape we need:

```typescript
type AgentInfo = {
  address: `0x${string}`;
  name: string;
  registered_at: bigint;
  name_updated_at: bigint;
};
```

- [ ] **Step 3: Write the failing test (mock-based — no live chain)**

Create `voucher-backend/src/agent-registrar/vara-agent.reader.spec.ts`:

```typescript
import { VaraAgentReader, AgentInfo } from './vara-agent.reader';

describe('VaraAgentReader (decoding)', () => {
  it('normalizes registered_at + name_updated_at to bigint', () => {
    const raw = {
      address: '0x' + 'aa'.repeat(32),
      name: 'happy',
      registered_at: '12345',
      name_updated_at: 12346,
    };
    const decoded: AgentInfo = VaraAgentReader.normalizeAgent(raw);
    expect(decoded.address).toBe('0x' + 'aa'.repeat(32));
    expect(decoded.name).toBe('happy');
    expect(decoded.registered_at).toBe(12345n);
    expect(decoded.name_updated_at).toBe(12346n);
  });

  it('returns null when the on-chain Option is None', () => {
    expect(VaraAgentReader.normalizeAgentOption(null)).toBeNull();
    expect(VaraAgentReader.normalizeAgentOption(undefined)).toBeNull();
  });

  it('returns the decoded agent when Option is Some', () => {
    const raw = { address: '0xabc', name: 'a', registered_at: 1, name_updated_at: 2 };
    const decoded = VaraAgentReader.normalizeAgentOption(raw)!;
    expect(decoded.name).toBe('a');
    expect(decoded.registered_at).toBe(1n);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd voucher-backend && npx jest src/agent-registrar/vara-agent.reader.spec.ts -i`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the reader**

Create `voucher-backend/src/agent-registrar/vara-agent.reader.ts`:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GearApi, HexString } from '@gear-js/api';
import { TypeRegistry } from '@polkadot/types';
import { decodeAddress } from '@gear-js/api';

export type AgentInfo = {
  address: HexString;
  name: string;
  registered_at: bigint;
  name_updated_at: bigint;
};

type RawAgent = {
  address: string;
  name: string;
  registered_at: bigint | number | string;
  name_updated_at: bigint | number | string;
};

@Injectable()
export class VaraAgentReader implements OnModuleInit {
  private logger = new Logger(VaraAgentReader.name);
  private api: GearApi;
  private registry: TypeRegistry;
  private nodeUrl: string;
  private programId: HexString;

  constructor(private readonly configService: ConfigService) {
    this.nodeUrl = configService.get('nodeUrl');
    this.programId = configService.get<HexString>(
      'agentRegistrar.basketMarketProgramId',
    );
    this.api = new GearApi({ providerAddress: this.nodeUrl });
    this.registry = new TypeRegistry();
    this.registry.register({
      AgentInfo: {
        address: '[u8;32]',
        name: 'String',
        registered_at: 'u64',
        name_updated_at: 'u64',
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.api.isReadyOrError;
    this.logger.log(
      `VaraAgentReader connected to ${this.nodeUrl}, basket=${this.programId}`,
    );
  }

  private async ensureConnected(): Promise<GearApi> {
    if (this.api.isConnected) return this.api;
    this.logger.warn('GearApi disconnected — reconnecting');
    try {
      await this.api.disconnect();
    } catch {
      // socket may already be dead
    }
    this.api = new GearApi({ providerAddress: this.nodeUrl });
    await this.api.isReadyOrError;
    return this.api;
  }

  static normalizeAgent(raw: RawAgent): AgentInfo {
    return {
      address: raw.address as HexString,
      name: raw.name,
      registered_at: BigInt(raw.registered_at as never),
      name_updated_at: BigInt(raw.name_updated_at as never),
    };
  }

  static normalizeAgentOption(raw: RawAgent | null | undefined): AgentInfo | null {
    if (raw === null || raw === undefined) return null;
    return VaraAgentReader.normalizeAgent(raw);
  }

  /**
   * Read the on-chain agent record for an SS58 address. Decodes to 0x hex
   * and queries `BasketMarket.GetAgent`. Returns null if the address has not
   * registered yet.
   */
  async getAgent(accountSs58: string): Promise<AgentInfo | null> {
    const api = await this.ensureConnected();
    const accountHex = decodeAddress(accountSs58) as HexString;

    const payloadType = '[u8;32]';
    const replyType = 'Option<AgentInfo>';
    const callPayload = this.registry
      .createType(payloadType, accountHex)
      .toU8a();

    // Use the raw send-message RPC. Sails uses (program_id, payload, value, gas)
    // calculate via api.message.calculateReplyForHandle for read-only queries.
    const reply = await (api as any).message.calculateReplyForHandle(
      undefined,
      this.programId,
      this.encodePayload('GetAgent', callPayload),
    );
    const decoded = this.registry.createType(
      `(String,String,${replyType})`,
      reply.payload,
    );
    const option = (decoded as any)[2];
    if (option.isNone) return null;
    const inner = option.unwrap().toJSON() as RawAgent;
    return VaraAgentReader.normalizeAgent(inner);
  }

  /**
   * Read the full agent list. Used by the reconciler.
   */
  async getAllAgents(): Promise<AgentInfo[]> {
    const api = await this.ensureConnected();
    const replyType = 'Vec<AgentInfo>';
    const reply = await (api as any).message.calculateReplyForHandle(
      undefined,
      this.programId,
      this.encodePayload('GetAllAgents'),
    );
    const decoded = this.registry.createType(
      `(String,String,${replyType})`,
      reply.payload,
    );
    const list = (decoded as any)[2].toJSON() as RawAgent[];
    return list.map((r) => VaraAgentReader.normalizeAgent(r));
  }

  private encodePayload(method: 'GetAgent' | 'GetAllAgents', args?: Uint8Array): Uint8Array {
    const service = this.registry.createType('String', 'BasketMarket').toU8a();
    const fn = this.registry.createType('String', method).toU8a();
    const tail = args ?? new Uint8Array();
    const out = new Uint8Array(service.length + fn.length + tail.length);
    out.set(service, 0);
    out.set(fn, service.length);
    out.set(tail, service.length + fn.length);
    return out;
  }
}
```

> **Implementation note for the executing engineer:** the `calculateReplyForHandle` shape above is the documented Gear RPC for read-only Sails queries. If your installed `@gear-js/api` 0.39 surface differs (method name, signature), use the equivalent — `api.programState.read` plus a cross-check with the frontend `basket-market-client/lib.ts`'s `QueryBuilder` is acceptable. The static `normalizeAgent` helpers are independent of the RPC mechanism and are what the unit test pins down.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd voucher-backend && npx jest src/agent-registrar/vara-agent.reader.spec.ts -i`
Expected: PASS, all three cases.

- [ ] **Step 7: Commit**

```bash
git add voucher-backend/src/agent-registrar/vara-agent.reader.ts voucher-backend/src/agent-registrar/vara-agent.reader.spec.ts
git commit -m "feat(agent-registrar): add Vara on-chain reader for agent records"
```

---

## Task 5: Offchain Manager client (singleton wrapper)

**Files:**
- Create: `voucher-backend/src/agent-registrar/offchain-manager.client.ts`
- Create: `voucher-backend/src/agent-registrar/offchain-manager.client.spec.ts`

Wraps `@thenamespace/offchain-manager`. Holds the API key in a module-private variable. Exposes only the methods the service uses — never exposes the underlying client.

- [ ] **Step 1: Write the failing test**

Create `voucher-backend/src/agent-registrar/offchain-manager.client.spec.ts`:

```typescript
import { ConfigService } from '@nestjs/config';
import { OffchainManagerClient } from './offchain-manager.client';

jest.mock('@thenamespace/offchain-manager', () => {
  return {
    createOffchainClient: jest.fn(() => ({
      isSubnameAvailable: jest.fn(async () => ({ isAvailable: true })),
      createSubname: jest.fn(async () => ({ fullName: 'happy.polybaskets.eth' })),
      setRecords: jest.fn(async () => undefined),
      getFilteredSubnames: jest.fn(async () => ({ items: [] })),
    })),
    ChainName: { Ethereum: 'Ethereum' },
  };
});

function makeConfig(): ConfigService {
  return {
    get: (key: string) => {
      const map: Record<string, unknown> = {
        'agentRegistrar.namespaceApiKey': 'ns-test',
        'agentRegistrar.namespaceMode': 'sepolia',
        'agentRegistrar.parentName': 'polybaskets.eth',
        'agentRegistrar.ownerEvm': '0xowner',
      };
      return map[key];
    },
  } as unknown as ConfigService;
}

describe('OffchainManagerClient', () => {
  it('initializes with mode + parent + owner from config', () => {
    const c = new OffchainManagerClient(makeConfig());
    expect(c.parentName).toBe('polybaskets.eth');
    expect(c.ownerEvm).toBe('0xowner');
  });

  it('does not echo the API key in toString or JSON', () => {
    const c = new OffchainManagerClient(makeConfig());
    expect(JSON.stringify(c)).not.toContain('ns-test');
    expect(String(c)).not.toContain('ns-test');
  });

  it('isAvailable proxies through the SDK', async () => {
    const c = new OffchainManagerClient(makeConfig());
    expect(await c.isAvailable('happy.polybaskets.eth')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd voucher-backend && npx jest src/agent-registrar/offchain-manager.client.spec.ts -i`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

Create `voucher-backend/src/agent-registrar/offchain-manager.client.ts`:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChainName,
  createOffchainClient,
} from '@thenamespace/offchain-manager';

const API_KEY = Symbol('apiKey');

export type Address = { chain: string; value: string };
export type Texts = Record<string, string | null>;

export type CreateSubnameInput = {
  label: string;
  texts: Texts;
  addresses: Address[];
  varaAddress: string;
};

export type SetRecordsInput = {
  fullName: string;
  texts: Texts;
  addresses: Address[];
};

export type SubnameSummary = {
  fullName: string;
  label: string;
  varaAddressMetadata: string | null;
  texts: Record<string, string>;
  addresses: Address[];
};

@Injectable()
export class OffchainManagerClient implements OnModuleInit {
  private logger = new Logger(OffchainManagerClient.name);
  // SDK client; never exposed publicly. Accessed via the symbol-keyed property
  // so a JSON.stringify of `this` cannot leak it via own-key enumeration.
  private [API_KEY]: ReturnType<typeof createOffchainClient>;
  public readonly parentName: string;
  public readonly ownerEvm: string;

  constructor(private readonly configService: ConfigService) {
    const mode = configService.get<'mainnet' | 'sepolia'>(
      'agentRegistrar.namespaceMode',
    );
    const apiKey = configService.get<string>('agentRegistrar.namespaceApiKey');
    this.parentName = configService.get<string>('agentRegistrar.parentName');
    this.ownerEvm = configService.get<string>('agentRegistrar.ownerEvm');
    this[API_KEY] = createOffchainClient({ mode, defaultApiKey: apiKey });
  }

  onModuleInit(): void {
    this.logger.log(
      `OffchainManagerClient ready: parent=${this.parentName} owner=${this.ownerEvm} apiKeySet=${this[API_KEY] ? 'yes' : 'no'}`,
    );
  }

  async isAvailable(fullName: string): Promise<boolean> {
    const r = await this[API_KEY].isSubnameAvailable(fullName);
    return r.isAvailable;
  }

  async findByVaraAddress(varaAddress: string): Promise<SubnameSummary | null> {
    const page = await this[API_KEY].getFilteredSubnames({
      parentName: this.parentName,
      metadata: { varaAddress },
      page: 1,
      size: 1,
    });
    const hit = page.items[0];
    if (!hit) return null;
    return this.toSummary(hit);
  }

  async getByLabel(label: string): Promise<SubnameSummary | null> {
    const page = await this[API_KEY].getFilteredSubnames({
      parentName: this.parentName,
      label,
      page: 1,
      size: 1,
    });
    const hit = page.items[0];
    if (!hit) return null;
    return this.toSummary(hit);
  }

  async create(input: CreateSubnameInput): Promise<string> {
    const result = await this[API_KEY].createSubname({
      label: input.label,
      parentName: this.parentName,
      owner: this.ownerEvm,
      addresses: input.addresses.map((a) => ({
        chain: this.toChainName(a.chain),
        value: a.value,
      })),
      texts: Object.entries(input.texts)
        .filter(([, v]) => v !== null)
        .map(([key, value]) => ({ key, value: value as string })),
      metadata: [{ key: 'varaAddress', value: input.varaAddress }],
    });
    return result.fullName ?? `${input.label}.${this.parentName}`;
  }

  async setRecords(input: SetRecordsInput): Promise<void> {
    await this[API_KEY].setRecords({
      fullName: input.fullName,
      addresses: input.addresses.map((a) => ({
        chain: this.toChainName(a.chain),
        value: a.value,
      })),
      // SDK convention: explicit empty string deletes a record.
      texts: Object.entries(input.texts).map(([key, value]) => ({
        key,
        value: value === null ? '' : value,
      })),
    });
  }

  private toChainName(chain: string): ChainName {
    const map = ChainName as unknown as Record<string, ChainName>;
    if (chain in map) return map[chain];
    throw new Error(`unsupported chain "${chain}"`);
  }

  private toSummary(hit: any): SubnameSummary {
    const meta = (hit.metadata ?? []) as Array<{ key: string; value: string }>;
    return {
      fullName: hit.fullName,
      label: hit.label,
      varaAddressMetadata: meta.find((m) => m.key === 'varaAddress')?.value ?? null,
      texts: Object.fromEntries(
        ((hit.texts ?? []) as Array<{ key: string; value: string }>).map(
          (t) => [t.key, t.value],
        ),
      ),
      addresses: ((hit.addresses ?? []) as Array<{ chain: string; value: string }>).map(
        (a) => ({ chain: a.chain, value: a.value }),
      ),
    };
  }

  toJSON(): Record<string, unknown> {
    return { parentName: this.parentName, ownerEvm: this.ownerEvm };
  }

  toString(): string {
    return `OffchainManagerClient(parent=${this.parentName})`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd voucher-backend && npx jest src/agent-registrar/offchain-manager.client.spec.ts -i`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add voucher-backend/src/agent-registrar/offchain-manager.client.ts voucher-backend/src/agent-registrar/offchain-manager.client.spec.ts
git commit -m "feat(agent-registrar): add Namespace SDK wrapper with API-key isolation"
```

---

## Task 6: IP register cap (in-memory)

**Files:**
- Create: `voucher-backend/src/agent-registrar/ip-register-cap.ts`
- Create: `voucher-backend/src/agent-registrar/ip-register-cap.spec.ts`

Tiny in-memory `Map<ip, { day, count }>` mirroring the voucher service's IP gate. Public API: `tryReserve(ip): { ok: true } | { ok: false; retryAfterSec }`. Per-UTC-day, default cap 5.

- [ ] **Step 1: Write the failing test**

Create `voucher-backend/src/agent-registrar/ip-register-cap.spec.ts`:

```typescript
import { IpRegisterCap } from './ip-register-cap';

describe('IpRegisterCap', () => {
  let cap: IpRegisterCap;

  beforeEach(() => {
    cap = new IpRegisterCap(3); // 3/day for tests
  });

  it('allows up to the cap and rejects after', () => {
    expect(cap.tryReserve('1.1.1.1').ok).toBe(true);
    expect(cap.tryReserve('1.1.1.1').ok).toBe(true);
    expect(cap.tryReserve('1.1.1.1').ok).toBe(true);
    const denied = cap.tryReserve('1.1.1.1');
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it('isolates IPs from each other', () => {
    for (let i = 0; i < 3; i++) cap.tryReserve('a');
    expect(cap.tryReserve('b').ok).toBe(true);
  });

  it('disabled when cap <= 0', () => {
    const open = new IpRegisterCap(0);
    for (let i = 0; i < 100; i++) {
      expect(open.tryReserve('z').ok).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd voucher-backend && npx jest src/agent-registrar/ip-register-cap.spec.ts -i`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the cap**

Create `voucher-backend/src/agent-registrar/ip-register-cap.ts`:

```typescript
export type ReserveResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

export class IpRegisterCap {
  private state = new Map<string, { day: string; count: number }>();

  constructor(private readonly cap: number) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private secondsUntilUtcMidnight(): number {
    const now = new Date();
    const next = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      ),
    );
    return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
  }

  tryReserve(ip: string): ReserveResult {
    if (this.cap <= 0) return { ok: true };

    const today = this.today();
    const slot = this.state.get(ip);
    if (!slot || slot.day !== today) {
      this.state.set(ip, { day: today, count: 1 });
      return { ok: true };
    }
    if (slot.count >= this.cap) {
      return { ok: false, retryAfterSec: this.secondsUntilUtcMidnight() };
    }
    slot.count += 1;
    return { ok: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd voucher-backend && npx jest src/agent-registrar/ip-register-cap.spec.ts -i`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add voucher-backend/src/agent-registrar/ip-register-cap.ts voucher-backend/src/agent-registrar/ip-register-cap.spec.ts
git commit -m "feat(agent-registrar): add per-IP per-UTC-day register cap"
```

---

## Task 7: Service — name validation + reserved set

**Files:**
- Create: `voucher-backend/src/agent-registrar/name-rules.ts`
- Create: `voucher-backend/src/agent-registrar/name-rules.spec.ts`

Pure-function helpers shared between the service and the controller's idempotency path.

- [ ] **Step 1: Write the failing test**

Create `voucher-backend/src/agent-registrar/name-rules.spec.ts`:

```typescript
import { isNameAllowed, RESERVED_NAMES } from './name-rules';

describe('name-rules', () => {
  it('accepts valid names', () => {
    expect(isNameAllowed('happy')).toBe(true);
    expect(isNameAllowed('happy-bot')).toBe(true);
    expect(isNameAllowed('a1b2-c3')).toBe(true);
  });

  it('rejects reserved names', () => {
    for (const r of RESERVED_NAMES) {
      expect(isNameAllowed(r)).toBe(false);
    }
  });

  it('rejects bad chars', () => {
    expect(isNameAllowed('Happy')).toBe(false);
    expect(isNameAllowed('hi!')).toBe(false);
    expect(isNameAllowed('-leading')).toBe(false);
    expect(isNameAllowed('trailing-')).toBe(false);
  });

  it('rejects bad length', () => {
    expect(isNameAllowed('ab')).toBe(false);
    expect(isNameAllowed('a'.repeat(21))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd voucher-backend && npx jest src/agent-registrar/name-rules.spec.ts -i`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `voucher-backend/src/agent-registrar/name-rules.ts`:

```typescript
export const RESERVED_NAMES = new Set([
  'default',
  'admin',
  'polybaskets',
  'root',
  'ens',
  'system',
]);

const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])$/;

export function isNameAllowed(name: string): boolean {
  if (RESERVED_NAMES.has(name)) return false;
  return NAME_PATTERN.test(name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd voucher-backend && npx jest src/agent-registrar/name-rules.spec.ts -i`
Expected: PASS, all four cases.

- [ ] **Step 5: Commit**

```bash
git add voucher-backend/src/agent-registrar/name-rules.ts voucher-backend/src/agent-registrar/name-rules.spec.ts
git commit -m "feat(agent-registrar): add name validation + reserved word set"
```

---

## Task 8: Service — register flow

**Files:**
- Create: `voucher-backend/src/agent-registrar/agent-registrar.service.ts`
- Create: `voucher-backend/src/agent-registrar/agent-registrar.service.spec.ts`

Wires DTO → on-chain verify → SDK create. Handles the `202 pending` case when chain finality lags. Idempotent for re-claim by the same Vara address.

- [ ] **Step 1: Write the failing test**

Create `voucher-backend/src/agent-registrar/agent-registrar.service.spec.ts`:

```typescript
import { ConfigService } from '@nestjs/config';
import { AgentRegistrarService } from './agent-registrar.service';
import { OffchainManagerClient } from './offchain-manager.client';
import { VaraAgentReader, AgentInfo } from './vara-agent.reader';
import { IpRegisterCap } from './ip-register-cap';

const SS58_VALID = 'kGiN6mGtg2eLmQfFE3pxneeqAKbEERrkfwiTYbpMNCpMrqUdH';
const HEX = ('0x' + 'ab'.repeat(32)) as `0x${string}`;

function makeService(opts: {
  agent?: AgentInfo | null;
  agentSequence?: Array<AgentInfo | null>;
  available?: boolean;
  existing?: Awaited<ReturnType<OffchainManagerClient['findByVaraAddress']>>;
}): {
  service: AgentRegistrarService;
  reader: jest.Mocked<VaraAgentReader>;
  client: jest.Mocked<OffchainManagerClient>;
} {
  const reader = {
    getAgent: jest.fn(),
    getAllAgents: jest.fn(async () => []),
  } as unknown as jest.Mocked<VaraAgentReader>;

  if (opts.agentSequence) {
    let i = 0;
    (reader.getAgent as jest.Mock).mockImplementation(async () => {
      const v = opts.agentSequence![i] ?? opts.agentSequence![opts.agentSequence!.length - 1];
      i++;
      return v;
    });
  } else {
    (reader.getAgent as jest.Mock).mockResolvedValue(opts.agent ?? null);
  }

  const client = {
    parentName: 'polybaskets.eth',
    ownerEvm: '0xowner',
    isAvailable: jest.fn(async () => opts.available ?? true),
    findByVaraAddress: jest.fn(async () => opts.existing ?? null),
    getByLabel: jest.fn(async () => null),
    create: jest.fn(async () => 'happy.polybaskets.eth'),
    setRecords: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<OffchainManagerClient>;

  const config = {
    get: (key: string) => {
      if (key === 'agentRegistrar.retryIntervalMs') return 10;
      if (key === 'agentRegistrar.retryMaxAttempts') return 6; // 60ms total — short for tests
      return undefined;
    },
  } as unknown as ConfigService;

  const service = new AgentRegistrarService(reader, client, config, new IpRegisterCap(0));
  return { service, reader, client };
}

describe('AgentRegistrarService.register', () => {
  it('creates a subname when on-chain matches', async () => {
    const { service, client } = makeService({
      agent: { address: HEX, name: 'happy', registered_at: 1n, name_updated_at: 1n },
      available: true,
    });

    const r = await service.register({
      account: SS58_VALID,
      name: 'happy',
      profile: { texts: { description: 'hi' }, ethAddress: '0x' + '1'.repeat(40) },
    }, '1.1.1.1');

    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.fullName).toBe('happy.polybaskets.eth');
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it('rejects when on-chain name differs', async () => {
    const { service } = makeService({
      agent: { address: HEX, name: 'other', registered_at: 1n, name_updated_at: 1n },
    });
    await expect(
      service.register({ account: SS58_VALID, name: 'happy' }, '1.1.1.1'),
    ).rejects.toThrow(/on-chain name mismatch/);
  });

  it('returns pending when on-chain not yet visible after retries', async () => {
    const { service } = makeService({ agentSequence: [null, null, null, null, null, null] });
    const r = await service.register(
      { account: SS58_VALID, name: 'happy' },
      '1.1.1.1',
    );
    expect(r.status).toBe('pending');
  });

  it('is idempotent on re-claim (same vara address)', async () => {
    const { service, client } = makeService({
      agent: { address: HEX, name: 'happy', registered_at: 1n, name_updated_at: 1n },
      available: false,
      existing: {
        fullName: 'happy.polybaskets.eth',
        label: 'happy',
        varaAddressMetadata: HEX,
        texts: {},
        addresses: [],
      },
    });
    const r = await service.register(
      { account: SS58_VALID, name: 'happy', profile: { texts: { description: 'updated' } } },
      '1.1.1.1',
    );
    expect(r.status).toBe('ok');
    expect(client.setRecords).toHaveBeenCalledTimes(1);
    expect(client.create).not.toHaveBeenCalled();
  });

  it('rejects reserved name', async () => {
    const { service } = makeService({});
    await expect(
      service.register({ account: SS58_VALID, name: 'admin' }, '1.1.1.1'),
    ).rejects.toThrow(/reserved/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd voucher-backend && npx jest src/agent-registrar/agent-registrar.service.spec.ts -i`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement service**

Create `voucher-backend/src/agent-registrar/agent-registrar.service.ts`:

```typescript
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decodeAddress, HexString } from '@gear-js/api';
import { VaraAgentReader, AgentInfo } from './vara-agent.reader';
import {
  OffchainManagerClient,
  Address,
  Texts,
} from './offchain-manager.client';
import { IpRegisterCap } from './ip-register-cap';
import { isNameAllowed } from './name-rules';
import { ProfileDto } from './dto/profile.dto';
import { RegisterAgentDto } from './dto/register-agent.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

export type RegisterResult =
  | { status: 'ok'; fullName: string; varaAddress: HexString }
  | { status: 'pending'; varaAddress: HexString };

@Injectable()
export class AgentRegistrarService {
  private logger = new Logger(AgentRegistrarService.name);

  constructor(
    private readonly reader: VaraAgentReader,
    private readonly client: OffchainManagerClient,
    private readonly configService: ConfigService,
    private readonly ipCap: IpRegisterCap,
  ) {}

  async register(dto: RegisterAgentDto, ip: string): Promise<RegisterResult> {
    if (!isNameAllowed(dto.name)) {
      throw new BadRequestException(`name "${dto.name}" is invalid or reserved`);
    }

    const account = this.decode(dto.account);

    const reservation = this.ipCap.tryReserve(ip);
    if (!reservation.ok) {
      throw new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Daily agent register cap exceeded for this IP',
          retryAfterSec: reservation.retryAfterSec,
        },
        429,
      );
    }

    const onChain = await this.pollGetAgent(dto.account);
    if (!onChain) {
      this.logger.log(`pending finality for ${account} → 202`);
      return { status: 'pending', varaAddress: account };
    }

    if (onChain.name !== dto.name) {
      throw new ConflictException(
        `on-chain name mismatch (got "${onChain.name}")`,
      );
    }

    return await this.upsertSubname(account, dto.name, dto.profile);
  }

  async updateProfile(dto: UpdateProfileDto): Promise<{ fullName: string }> {
    const account = this.decode(dto.account);

    const onChain = await this.reader.getAgent(dto.account);
    if (!onChain) {
      throw new ConflictException('agent not registered on-chain');
    }

    const summary = await this.client.findByVaraAddress(account);
    if (!summary) {
      throw new ConflictException(
        'no subname for this account; call POST /agent/register first',
      );
    }

    if (summary.label !== onChain.name) {
      throw new ConflictException(
        `stale subname (label "${summary.label}" != on-chain "${onChain.name}"); call POST /agent/register first`,
      );
    }

    const { texts, addresses } = this.buildRecords(dto.profile, account, summary.label);
    await this.client.setRecords({ fullName: summary.fullName, texts, addresses });
    return { fullName: summary.fullName };
  }

  async getProfile(accountSs58: string): Promise<{
    fullName: string;
    name: string;
    texts: Record<string, string>;
    addresses: Address[];
    varaAddress: string;
  } | null> {
    const account = this.decode(accountSs58);
    const summary = await this.client.findByVaraAddress(account);
    if (!summary) return null;
    return {
      fullName: summary.fullName,
      name: summary.label,
      texts: summary.texts,
      addresses: summary.addresses,
      varaAddress: account,
    };
  }

  /**
   * Idempotent upsert: creates the subname if free, updates records if the
   * subname already belongs to this Vara address, or rejects with 409 if
   * another account holds it.
   */
  private async upsertSubname(
    account: HexString,
    label: string,
    profile: ProfileDto | undefined,
  ): Promise<RegisterResult> {
    const fullName = `${label}.${this.client.parentName}`;
    const available = await this.client.isAvailable(fullName);
    const { texts, addresses } = this.buildRecords(profile ?? {}, account, label);

    if (available) {
      const created = await this.client.create({
        label,
        texts,
        addresses,
        varaAddress: account,
      });
      return { status: 'ok', fullName: created, varaAddress: account };
    }

    // Subname taken — does it belong to this account?
    const owned = await this.client.findByVaraAddress(account);
    if (owned && owned.label === label) {
      await this.client.setRecords({ fullName: owned.fullName, texts, addresses });
      return { status: 'ok', fullName: owned.fullName, varaAddress: account };
    }
    throw new ConflictException('subname taken by another account');
  }

  private buildRecords(
    profile: ProfileDto,
    account: HexString,
    label: string,
  ): { texts: Texts; addresses: Address[] } {
    const texts: Texts = { name: label, ...(profile.texts ?? {}) };
    const addresses: Address[] = [...(profile.addresses ?? [])];
    if (profile.ethAddress) {
      addresses.push({ chain: 'Ethereum', value: profile.ethAddress });
    }
    if (addresses.length === 0) {
      addresses.push({ chain: 'Ethereum', value: this.client.ownerEvm });
    }
    return { texts, addresses };
  }

  private decode(accountSs58: string): HexString {
    try {
      return decodeAddress(accountSs58) as HexString;
    } catch {
      throw new BadRequestException('Invalid account address');
    }
  }

  private async pollGetAgent(ss58: string): Promise<AgentInfo | null> {
    const intervalMs = this.configService.get<number>(
      'agentRegistrar.retryIntervalMs',
    );
    // Cap inline polling at 60s regardless of retryMaxAttempts. The reconciler
    // handles longer waits.
    const maxAttempts = Math.max(
      1,
      Math.min(
        this.configService.get<number>('agentRegistrar.retryMaxAttempts') ?? 1,
        Math.ceil(60_000 / intervalMs),
      ),
    );

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const a = await this.reader.getAgent(ss58);
        if (a) return a;
      } catch (e) {
        this.logger.warn(`getAgent failed during poll: ${(e as Error).message}`);
      }
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd voucher-backend && npx jest src/agent-registrar/agent-registrar.service.spec.ts -i`
Expected: PASS, all five cases.

- [ ] **Step 5: Commit**

```bash
git add voucher-backend/src/agent-registrar/agent-registrar.service.ts voucher-backend/src/agent-registrar/agent-registrar.service.spec.ts
git commit -m "feat(agent-registrar): add service with verify+upsert + 202 pending"
```

---

## Task 9: Reconciler (cron + one-shot migration)

**Files:**
- Create: `voucher-backend/src/agent-registrar/agent-reconciler.ts`
- Create: `voucher-backend/src/agent-registrar/agent-reconciler.spec.ts`

A `reconcileAgents(agents)` function (idempotent, per-agent failures logged + skipped) plus two callers: `runMigration()` triggered in `onModuleInit` when `MIGRATION_ENABLED=true`, and a `@Cron`-driven `reconcileTick()` that always runs.

- [ ] **Step 1: Write the failing test**

Create `voucher-backend/src/agent-registrar/agent-reconciler.spec.ts`:

```typescript
import { ConfigService } from '@nestjs/config';
import { AgentReconciler } from './agent-reconciler';
import type { AgentInfo } from './vara-agent.reader';
import type { OffchainManagerClient } from './offchain-manager.client';
import type { VaraAgentReader } from './vara-agent.reader';

const HEX = (x: string) => ('0x' + x.repeat(32)) as `0x${string}`;
const A: AgentInfo = { address: HEX('a'), name: 'alpha', registered_at: 1n, name_updated_at: 1n };
const B: AgentInfo = { address: HEX('b'), name: 'beta', registered_at: 2n, name_updated_at: 2n };

function build(): { rec: AgentReconciler; client: any; reader: any } {
  const reader = {
    getAllAgents: jest.fn(async () => [A, B]),
    getAgent: jest.fn(async () => null),
  } as unknown as VaraAgentReader;
  const client = {
    parentName: 'polybaskets.eth',
    ownerEvm: '0xowner',
    findByVaraAddress: jest.fn(async (addr: string) => (addr === A.address ? { fullName: 'alpha.polybaskets.eth', label: 'alpha', varaAddressMetadata: A.address, texts: {}, addresses: [] } : null)),
    isAvailable: jest.fn(async () => true),
    create: jest.fn(async () => 'beta.polybaskets.eth'),
    setRecords: jest.fn(),
  } as unknown as OffchainManagerClient;
  const cfg = { get: () => false } as unknown as ConfigService;
  const rec = new AgentReconciler(reader, client, cfg);
  return { rec, client, reader };
}

describe('AgentReconciler', () => {
  it('creates only the missing subname', async () => {
    const { rec, client } = build();
    const summary = await rec.reconcileAgents([A, B]);
    expect(summary).toEqual({ total: 2, created: 1, skipped: 1, failed: 0 });
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it('continues on per-agent failures', async () => {
    const { rec, client } = build();
    (client.create as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const summary = await rec.reconcileAgents([A, B]);
    expect(summary.failed).toBe(1);
    expect(summary.created).toBe(0);
  });

  it('runMigration is a no-op when MIGRATION_ENABLED is false', async () => {
    const { rec, reader } = build();
    await rec.runMigration();
    expect((reader as any).getAllAgents).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd voucher-backend && npx jest src/agent-registrar/agent-reconciler.spec.ts -i`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reconciler**

Create `voucher-backend/src/agent-registrar/agent-reconciler.ts`:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OffchainManagerClient } from './offchain-manager.client';
import { VaraAgentReader, AgentInfo } from './vara-agent.reader';

export type ReconcileSummary = {
  total: number;
  created: number;
  skipped: number;
  failed: number;
};

@Injectable()
export class AgentReconciler implements OnModuleInit {
  private logger = new Logger(AgentReconciler.name);
  private attempts = new Map<string, number>();
  private maxAttempts: number;

  constructor(
    private readonly reader: VaraAgentReader,
    private readonly client: OffchainManagerClient,
    private readonly configService: ConfigService,
  ) {
    this.maxAttempts =
      configService.get<number>('agentRegistrar.retryMaxAttempts') ?? 288;
  }

  async onModuleInit(): Promise<void> {
    await this.runMigration();
  }

  async runMigration(): Promise<void> {
    const enabled = this.configService.get<boolean>(
      'agentRegistrar.migrationEnabled',
    );
    if (!enabled) return;
    const agents = await this.reader.getAllAgents();
    const summary = await this.reconcileAgents(agents);
    this.logger.log(
      `migration complete: total=${summary.total} created=${summary.created} skipped=${summary.skipped} failed=${summary.failed}`,
    );
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async reconcileTick(): Promise<void> {
    try {
      const agents = await this.reader.getAllAgents();
      await this.reconcileAgents(agents);
    } catch (e) {
      this.logger.warn(`reconcile tick failed: ${(e as Error).message}`);
    }
  }

  async reconcileAgents(agents: AgentInfo[]): Promise<ReconcileSummary> {
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const agent of agents) {
      const attempts = (this.attempts.get(agent.address) ?? 0) + 1;
      if (attempts > this.maxAttempts) {
        skipped++;
        continue;
      }

      try {
        const existing = await this.client.findByVaraAddress(agent.address);
        if (existing && existing.label === agent.name) {
          skipped++;
          this.attempts.delete(agent.address);
          continue;
        }
        if (existing && existing.label !== agent.name) {
          // Stale subname (agent renamed on-chain). Don't auto-rewrite from
          // the cron — the agent is expected to call POST /agent/register
          // again to claim the new label. Skip + move on.
          skipped++;
          continue;
        }

        const fullName = `${agent.name}.${this.client.parentName}`;
        const available = await this.client.isAvailable(fullName);
        if (!available) {
          // Someone else holds the label — flag and skip.
          this.logger.warn(
            `cannot reconcile ${agent.address}: subname ${fullName} is taken`,
          );
          skipped++;
          continue;
        }

        await this.client.create({
          label: agent.name,
          texts: { name: agent.name },
          addresses: [{ chain: 'Ethereum', value: this.client.ownerEvm }],
          varaAddress: agent.address,
        });
        created++;
        this.attempts.delete(agent.address);
      } catch (e) {
        this.logger.warn(
          `reconcile failed for ${agent.address}: ${(e as Error).message}`,
        );
        this.attempts.set(agent.address, attempts);
        failed++;
      }
    }

    return { total: agents.length, created, skipped, failed };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd voucher-backend && npx jest src/agent-registrar/agent-reconciler.spec.ts -i`
Expected: PASS, all three cases.

- [ ] **Step 5: Commit**

```bash
git add voucher-backend/src/agent-registrar/agent-reconciler.ts voucher-backend/src/agent-registrar/agent-reconciler.spec.ts
git commit -m "feat(agent-registrar): add cron reconciler + one-shot migration"
```

---

## Task 10: Controller + module wiring

**Files:**
- Create: `voucher-backend/src/agent-registrar/agent-registrar.controller.ts`
- Modify: `voucher-backend/src/agent-registrar/agent-registrar.module.ts`

- [ ] **Step 1: Implement the controller**

Create `voucher-backend/src/agent-registrar/agent-registrar.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AgentRegistrarService } from './agent-registrar.service';
import { RegisterAgentDto } from './dto/register-agent.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const REGISTER_THROTTLE = { default: { limit: 6, ttl: 3600000 } };
const PATCH_THROTTLE = { default: { limit: 12, ttl: 3600000 } };
const GET_THROTTLE = { default: { limit: 20, ttl: 60000 } };

@Controller('agent')
export class AgentRegistrarController {
  constructor(private readonly service: AgentRegistrarService) {}

  @Post('register')
  @Throttle(REGISTER_THROTTLE)
  async register(
    @Body() body: RegisterAgentDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.register(body, ip);
    if (result.status === 'pending') {
      res.status(202);
      return { status: 'pending', varaAddress: result.varaAddress };
    }
    return {
      status: 'ok',
      fullName: result.fullName,
      varaAddress: result.varaAddress,
    };
  }

  @Patch('profile')
  @Throttle(PATCH_THROTTLE)
  updateProfile(@Body() body: UpdateProfileDto) {
    return this.service.updateProfile(body);
  }

  @Get('profile/:account')
  @Throttle(GET_THROTTLE)
  async getProfile(@Param('account') account: string) {
    const profile = await this.service.getProfile(account);
    return profile ?? { status: 'not_found' };
  }
}
```

- [ ] **Step 2: Wire providers in the module**

Replace the contents of `voucher-backend/src/agent-registrar/agent-registrar.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AgentRegistrarController } from './agent-registrar.controller';
import { AgentRegistrarService } from './agent-registrar.service';
import { OffchainManagerClient } from './offchain-manager.client';
import { VaraAgentReader } from './vara-agent.reader';
import { AgentReconciler } from './agent-reconciler';
import { IpRegisterCap } from './ip-register-cap';

@Module({
  imports: [ConfigModule],
  controllers: [AgentRegistrarController],
  providers: [
    AgentRegistrarService,
    OffchainManagerClient,
    VaraAgentReader,
    AgentReconciler,
    {
      provide: IpRegisterCap,
      useFactory: () => new IpRegisterCap(5),
      inject: [ConfigService],
    },
  ],
  exports: [],
})
export class AgentRegistrarModule {}
```

- [ ] **Step 3: Verify build**

Run:

```bash
cd voucher-backend
npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Run all agent-registrar tests**

Run: `cd voucher-backend && npx jest src/agent-registrar -i`
Expected: PASS for every spec file written so far.

- [ ] **Step 5: Commit**

```bash
git add voucher-backend/src/agent-registrar/agent-registrar.controller.ts voucher-backend/src/agent-registrar/agent-registrar.module.ts
git commit -m "feat(agent-registrar): wire controller and module providers"
```

---

## Task 11: Update STARTER_PROMPT.md

**Files:**
- Modify: `skills/STARTER_PROMPT.md`

- [ ] **Step 1: Augment the main Step 3 (around line 112)**

Open `skills/STARTER_PROMPT.md`. Locate the existing Step 3 (lines ~112–119). Replace it with:

```
> **Step 3 — Register your agent identity (mandatory, two parts)**
> Pick a unique lowercase agent name (3-20 chars, letters/numbers/hyphens).
>
> **Part A — register on-chain.** Only you can sign this; backend pays gas via your voucher.
>
>   vara-wallet --account agent call $BASKET_MARKET BasketMarket/RegisterAgent \
>     --args '["your-agent-name"]' \
>     --voucher
>
> If the account is already registered, continue. If the chosen name is taken, generate another unique name and retry.
>
> **Part B — claim the matching ENS subname.** Optional profile fields: description, com.twitter, com.github, com.discord, org.telegram, url, avatar, location, ethAddress. Skip any.
>
>   curl -fsS -X POST $VOUCHER_BACKEND/agent/register \
>     -H 'content-type: application/json' \
>     -d '{
>       "account":"<vara-ss58>",
>       "name":"your-agent-name",
>       "profile":{
>         "texts":{"description":"...", "com.twitter":"..."},
>         "ethAddress":"0x..."
>       }
>     }'
>
> 200 → <name>.polybaskets.eth claimed.
> 202 → pending finality; the reconciler will create it shortly. Continue, do not abort.
> 409 → name mismatch or label held by another account; fix and retry.
> 429 → wait `retryAfterSec` and retry. Do not abort.
>
> Edit profile later: `PATCH $VOUCHER_BACKEND/agent/profile` with the same body shape minus `name`.
```

- [ ] **Step 2: Add one-line follow-up after the duplicate snippets**

Find the second `vara-wallet ... RegisterAgent` block near line 281 (closing leaderboard step). Append directly after it:

```
>    Then claim/refresh the ENS subname: POST $VOUCHER_BACKEND/agent/register (see Step 3 Part B).
```

Find the third reference near line 350 (final report flow). Append the same one-line follow-up.

- [ ] **Step 3: Verify the prompt still scans**

Run:

```bash
wc -l skills/STARTER_PROMPT.md
grep -n "ENS subname\|/agent/register" skills/STARTER_PROMPT.md
```

Expected: line count ≤ original + ~30 lines, and three matches for `/agent/register` (Step 3 Part B + the two follow-up lines).

- [ ] **Step 4: Commit**

```bash
git add skills/STARTER_PROMPT.md
git commit -m "docs(starter): require ENS subname claim after RegisterAgent"
```

---

## Task 12: README + env template

**Files:**
- Modify: `voucher-backend/README.md` (if it documents env vars)
- Create or modify: `voucher-backend/.env.example`

The current `.env` has all the agent-registrar vars but is gitignored. We mirror them in `.env.example` so a fresh clone can boot.

- [ ] **Step 1: Check whether `.env.example` exists**

Run:

```bash
ls voucher-backend/.env.example 2>/dev/null && head -50 voucher-backend/.env.example || echo "MISSING"
```

If `MISSING`, copy the existing `.env` minus secret values into `.env.example` (the lines below). If it already exists, append the new section after the existing content.

- [ ] **Step 2: Add agent-registrar env section**

Ensure `voucher-backend/.env.example` contains the block below (add or append, do not duplicate existing lines):

```
# Agent registrar (ENS subnames under polybaskets.eth)
NAMESPACE_API_KEY=replace-with-namespace-key
NAMESPACE_MODE=mainnet
AGENT_PARENT_NAME=polybaskets.eth
POLYBASKETS_OWNER_EVM=0x0000000000000000000000000000000000000000
AGENT_RETRY_INTERVAL_MS=30000
AGENT_RETRY_MAX_ATTEMPTS=288
MIGRATION_ENABLED=false
```

- [ ] **Step 3: README note**

If `voucher-backend/README.md` has a section for env vars, append a brief paragraph about the agent registrar referencing the spec:

```
### Agent ENS subname registrar

After an agent calls `BasketMarket/RegisterAgent` on-chain, it should POST
`/agent/register` to claim the matching subname under `polybaskets.eth`.
The backend verifies the on-chain record and creates the subname via
`@thenamespace/offchain-manager`. A cron reconciler covers any agent that
registered on-chain but missed the endpoint call. See
`docs/superpowers/specs/2026-05-06-agent-ens-subname-design.md`.
```

If the README has no env section, skip this step (the .env.example is enough).

- [ ] **Step 4: Commit**

```bash
git add voucher-backend/.env.example voucher-backend/README.md
git commit -m "docs(agent-registrar): document env vars + endpoint flow"
```

---

## Task 13: Full test suite + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run full Jest suite**

Run:

```bash
cd voucher-backend
npm test
```

Expected: all tests pass (existing voucher tests + new agent-registrar tests).

- [ ] **Step 2: Boot smoke test against sepolia**

Set `voucher-backend/.env`:

```
NAMESPACE_MODE=sepolia
MIGRATION_ENABLED=false
```

(With a real sepolia `NAMESPACE_API_KEY` provisioned at https://dev.namespace.ninja, and `BASKET_MARKET_PROGRAM_ID` pointing at a deployed testnet BasketMarket.)

Run:

```bash
cd voucher-backend
npm run start:dev
```

Verify in logs:

- `VaraAgentReader connected to ...`
- `OffchainManagerClient ready: parent=polybaskets.eth ... apiKeySet=yes`
- No occurrences of the literal API key string in stdout. Confirm with: `npm run start:dev 2>&1 | grep -i "ns-" || echo "key not leaked"` (the API key starts with `ns-`).

- [ ] **Step 3: End-to-end POST**

With the dev server running, register a real testnet wallet on-chain via the existing `vara-wallet RegisterAgent` flow, then:

```bash
curl -fsS -X POST http://localhost:3001/agent/register \
  -H 'content-type: application/json' \
  -d '{
    "account": "<your-ss58>",
    "name": "smoke",
    "profile": {
      "texts": {"description": "ci smoke"},
      "ethAddress": "0x0000000000000000000000000000000000000001"
    }
  }'
```

Expected: `{"status":"ok","fullName":"smoke.polybaskets.eth","varaAddress":"0x..."}`.

- [ ] **Step 4: PATCH and GET round-trip**

```bash
curl -fsS -X PATCH http://localhost:3001/agent/profile \
  -H 'content-type: application/json' \
  -d '{"account":"<your-ss58>","profile":{"texts":{"description":"updated"}}}'

curl -fsS http://localhost:3001/agent/profile/<your-ss58>
```

Expected: GET response shows `texts.description == "updated"`.

- [ ] **Step 5: Migration smoke**

Set `MIGRATION_ENABLED=true`, restart the server. Verify a single log line of the form `migration complete: total=N created=X skipped=Y failed=0`. Set back to `false` and continue.

- [ ] **Step 6: Final commit if any local-only fixes were needed during smoke**

```bash
git status
git add -A
git commit -m "fix(agent-registrar): smoke-test corrections"
```

(Only run this if `git status` shows local changes; otherwise skip.)

---

## Task 14: Open PR

**Files:** none (git only)

- [ ] **Step 1: Push branch**

```bash
git push -u origin <current-branch>
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "Agent ENS subname registrar (lean PR)" --body "$(cat <<'EOF'
## Summary
- New `voucher-backend/src/agent-registrar/` module: `POST /agent/register` (verify on-chain → create ENS subname under `polybaskets.eth`), `PATCH /agent/profile`, `GET /agent/profile/:account`.
- Cron reconciler + `MIGRATION_ENABLED` one-shot mop up any agent that registered on-chain but missed the endpoint.
- STARTER_PROMPT.md augmented (not replaced) — agents still sign `RegisterAgent` themselves; ENS claim is a mandatory follow-up curl.
- API key isolation: held server-side, not echoed in logs/responses, never reachable through the controller surface.

Spec: `docs/superpowers/specs/2026-05-06-agent-ens-subname-design.md`.

## Test plan
- [x] Unit: configuration, DTOs, name-rules, ip-cap, reader normalization, SDK client, service register/update/get, reconciler.
- [ ] Sepolia smoke: POST → subname appears at app.ens.domains.
- [ ] PATCH/GET round-trip with non-default profile fields.
- [ ] `MIGRATION_ENABLED=true` reconciles existing on-chain agents idempotently.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Confirm PR URL is returned**

Print the PR URL emitted by `gh pr create`.

---

## Self-review notes (filled in after writing the plan)

**1. Spec coverage check:**

| Spec section | Plan task |
|---|---|
| New module structure | Tasks 1, 10 |
| External dependency install | Task 1 |
| Config entries | Task 2 |
| `POST /agent/register` flow | Tasks 3, 8, 10 |
| `PATCH /agent/profile` flow | Tasks 3, 8, 10 |
| `GET /agent/profile/:account` | Tasks 8, 10 |
| Profile fields (ENSIP pass-through) | Task 3 |
| Default record set | Task 8 (`buildRecords`) |
| Storage (in-memory IP cap) | Task 6 |
| 202 pending behavior | Task 8 |
| Migration / reconciliation | Task 9 |
| Security (API key isolation) | Tasks 5, 13 |
| STARTER_PROMPT.md change | Task 11 |
| Env vars | Task 12 |
| Test plan | Tasks 2–9, 13 |
| Rollout | Tasks 13, 14 |

**2. Placeholder scan:** all code blocks contain real implementation; no TBDs. The Vara reader (Task 4) carries an explicit "Implementation note" because the read-only RPC surface in `@gear-js/api` 0.39 has multiple equivalent shapes — the static helpers (`normalizeAgent`/`normalizeAgentOption`) are pinned by tests, the wire format is allowed to use whichever method exists in the installed version. This is a known unknown about an external API, not a hand-wave about our own code.

**3. Type consistency:** `AgentInfo`, `Address`, `Texts`, `RegisterResult`, `SubnameSummary`, and `ReserveResult` are defined in exactly one file each and reused with their declared shape across tasks. `ip` is `string` everywhere. `account` is `string` (SS58) at the API boundary, decoded to `HexString` (0x hex) inside the service.

**4. Scope:** single PR, single module, one prompt edit. No decomposition needed.
