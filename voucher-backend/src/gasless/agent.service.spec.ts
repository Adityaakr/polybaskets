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
    const result: any = await service.register(req as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects invalid label', async () => {
    const req = signedRegister('AB');
    const result: any = await service.register(req as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_label');
  });

  it('happy path: chain ok + ens ok → complete', async () => {
    const req = signedRegister('alice');
    const result: any = await service.register(req as any);
    expect(result.ok).toBe(true);
    expect(chain.registerAgent).toHaveBeenCalledWith('alice');
    expect(ens.createForAgent).toHaveBeenCalled();
  });

  it('chain failure aborts before ens', async () => {
    chain.registerAgent.mockResolvedValueOnce({ ok: false, reason: 'name_taken' });
    const req = signedRegister('bob');
    const result: any = await service.register(req as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('name_taken');
    expect(ens.createForAgent).not.toHaveBeenCalled();
  });

  it('ens failure leaves row at ens_pending', async () => {
    ens.createForAgent.mockRejectedValueOnce(new Error('boom'));
    const req = signedRegister('carol');
    const result: any = await service.register(req as any);
    expect(result.ok).toBe(true);
    const row = await (service as any).pending.findOneBy({ ss58: pair.address });
    expect(row.status).toBe('ens_pending');
  });
});

describe('AgentService.update', () => {
  let service: AgentService;
  let chain: jest.Mocked<ChainSubmitter>;
  let ens: jest.Mocked<OffchainManagerClient>;
  let alice: any;
  let bob: any;

  beforeAll(async () => {
    await waitReady();
    const keyring = new Keyring({ type: 'sr25519', ss58Format: 137 });
    alice = keyring.addFromUri('//AliceUpdate');
    bob = keyring.addFromUri('//BobImpostor');
  });

  beforeEach(async () => {
    chain = { registerAgent: jest.fn() } as any;
    ens = {
      createForAgent: jest.fn(),
      updateForAgent: jest.fn().mockResolvedValue(undefined),
      isAvailable: jest.fn(),
      reverseLookup: jest.fn(),
      forwardLookup: jest.fn(),
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

  function signedUpdate(
    pair: any,
    nonce: string,
    texts?: Record<string, string>,
    metadata?: Record<string, string>,
  ) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      ss58: pair.address,
      action: 'update' as const,
      texts,
      metadata,
      nonce,
      issuedAt: now,
      expiresAt: now + 600,
      audience: 'polybaskets.eth' as const,
    };
    const sig = pair.sign(canonicalize(payload));
    return { payload, signature: '0x' + Buffer.from(sig).toString('hex') };
  }

  it('rejects when no subname registered', async () => {
    ens.reverseLookup.mockResolvedValueOnce(null);
    const req = signedUpdate(alice, 'u-1', { name: 'Alice' });
    const result: any = await service.update(req as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_registered');
  });

  it('rejects when signer does not own the bound subname', async () => {
    ens.reverseLookup.mockResolvedValueOnce({
      label: 'alice',
      metadata: { varaAddress: alice.address },
    } as any);
    const req = signedUpdate(bob, 'u-2', { name: 'Bob trying to edit Alice' });
    const result: any = await service.update(req as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('forbidden');
  });

  it('rejects update of immutable metadata key (varaAddress)', async () => {
    ens.reverseLookup.mockResolvedValueOnce({
      label: 'alice',
      metadata: { varaAddress: alice.address },
    } as any);
    const req = signedUpdate(alice, 'u-3', undefined, {
      varaAddress: 'someoneElse',
    });
    const result: any = await service.update(req as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_field');
  });

  it('rejects bad avatar URL', async () => {
    ens.reverseLookup.mockResolvedValueOnce({
      label: 'alice',
      metadata: { varaAddress: alice.address },
    } as any);
    const req = signedUpdate(alice, 'u-4', { avatar: 'http://insecure.com/x.png' });
    const result: any = await service.update(req as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_field');
  });

  it('happy path: signer matches and fields valid', async () => {
    ens.reverseLookup.mockResolvedValueOnce({
      label: 'alice',
      metadata: { varaAddress: alice.address },
    } as any);
    const req = signedUpdate(alice, 'u-5', {
      name: 'Alice',
      avatar: 'https://example.com/a.png',
    });
    const result: any = await service.update(req as any);
    expect(result.ok).toBe(true);
    expect(ens.updateForAgent).toHaveBeenCalledWith({
      label: 'alice',
      texts: { name: 'Alice', avatar: 'https://example.com/a.png' },
      metadata: undefined,
    });
  });
});

describe('AgentService.reads', () => {
  let service: AgentService;
  let ens: jest.Mocked<OffchainManagerClient>;

  beforeEach(async () => {
    ens = {
      forwardLookup: jest.fn(),
      reverseLookup: jest.fn(),
      isAvailable: jest.fn(),
      createForAgent: jest.fn(),
      updateForAgent: jest.fn(),
    } as any;

    const readsConfig = {
      get: (k: string) => {
        const m: Record<string, any> = {
          'agents.payloadMaxAgeSeconds': 600,
          'agents.payloadClockSkewSeconds': 30,
          'agents.bulkReverseLookupMax': 100,
        };
        return m[k];
      },
    } as any as ConfigService;

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
        { provide: ConfigService, useValue: readsConfig },
        { provide: ChainSubmitter, useValue: { registerAgent: jest.fn() } },
        { provide: OffchainManagerClient, useValue: ens },
      ],
    }).compile();

    service = module.get(AgentService);
  });

  it('forward delegates to ens.forwardLookup', async () => {
    ens.forwardLookup.mockResolvedValueOnce({ label: 'alice' } as any);
    const result = await service.forward('alice');
    expect(result).toEqual({ label: 'alice' });
    expect(ens.forwardLookup).toHaveBeenCalledWith('alice');
  });

  it('reverse delegates to ens.reverseLookup', async () => {
    ens.reverseLookup.mockResolvedValueOnce({ label: 'alice' } as any);
    const result = await service.reverse('kGkAlice');
    expect(result).toEqual({ label: 'alice' });
    expect(ens.reverseLookup).toHaveBeenCalledWith('kGkAlice');
  });

  it('bulkReverse fans out and returns a map keyed by ss58', async () => {
    ens.reverseLookup.mockImplementation(async (s: string) => {
      if (s === 'a') return { label: 'aaa' } as any;
      if (s === 'b') return { label: 'bbb' } as any;
      return null;
    });
    const result = await service.bulkReverse(['a', 'b', 'c']);
    expect(result).toEqual({
      a: { label: 'aaa' },
      b: { label: 'bbb' },
      c: null,
    });
    expect(ens.reverseLookup).toHaveBeenCalledTimes(3);
  });

  it('bulkReverse caps at the configured max', async () => {
    ens.reverseLookup.mockResolvedValue(null);
    const inputs = Array.from({ length: 150 }, (_, i) => `ss58-${i}`);
    await service.bulkReverse(inputs);
    expect(ens.reverseLookup).toHaveBeenCalledTimes(100);
  });

  it('availability rejects invalid label without calling ens', async () => {
    const result = await service.availability('AB');
    expect(result.available).toBe(false);
    expect(ens.isAvailable).not.toHaveBeenCalled();
  });

  it('availability returns ens.isAvailable result for valid label', async () => {
    ens.isAvailable.mockResolvedValueOnce(true);
    const result = await service.availability('alice');
    expect(result.available).toBe(true);
    expect(ens.isAvailable).toHaveBeenCalledWith('alice');
  });
});
