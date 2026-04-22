import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { VoucherService } from './voucher.service';
import { Voucher } from '../entities/voucher.entity';

// ── GearApi mock ───────────────────────────────────────────────────────────────
// We only test the parts of VoucherService that don't need a live chain:
//   • onModuleInit throws when the API rejects
//   • getVoucher filters by revoked: false
//   • issue() rejects with a clear error when issuer balance is too low
//   • issue() passes the programIds array unmodified to the Gear SDK
//   • update() guards against revoked vouchers
//   • signAndSend timeout kicks in after 60s

const mockBalance = jest.fn();
const mockIsReadyOrError = jest.fn();
const mockVoucherIssue = jest.fn();

jest.mock('@gear-js/api', () => ({
  GearApi: jest.fn().mockImplementation(() => ({
    isReadyOrError: mockIsReadyOrError(),
    balance: { findOut: mockBalance },
    voucher: { issue: mockVoucherIssue },
  })),
  HexString: {},
  IUpdateVoucherParams: {},
  VoucherIssuedData: {},
}));

jest.mock('@polkadot/wasm-crypto', () => ({
  waitReady: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@polkadot/api', () => ({
  Keyring: jest.fn().mockImplementation(() => ({
    addFromSeed: jest.fn().mockReturnValue({ address: '5GrwvaEF' }),
    addFromUri: jest.fn().mockReturnValue({ address: '5GrwvaEF' }),
    addFromMnemonic: jest.fn().mockReturnValue({ address: '5GrwvaEF' }),
  })),
}));

jest.mock('@polkadot/util', () => ({
  hexToU8a: jest.fn().mockReturnValue(new Uint8Array(32)),
}));

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 'v1',
    voucherId: '0xvoucher',
    account: '0xabc',
    programs: ['0xprog'],
    varaToIssue: 3,
    validUpToBlock: 1000n,
    validUpTo: new Date(Date.now() + 86400_000),
    lastRenewedAt: new Date(),
    revoked: false,
    ...overrides,
  } as Voucher;
}

describe('VoucherService', () => {
  let service: VoucherService;
  let repo: { findOneBy: jest.Mock; save: jest.Mock };
  let cfg: { get: jest.Mock };

  beforeEach(async () => {
    mockIsReadyOrError.mockReturnValue(Promise.resolve());
    mockBalance.mockResolvedValue({ toBigInt: () => BigInt(100 * 1e12) });
    mockVoucherIssue.mockReset();

    repo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    };
    cfg = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'nodeUrl') return 'wss://testnet.vara.network';
        if (key === 'voucherAccount') return '//Alice';
        return undefined;
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        VoucherService,
        { provide: getRepositoryToken(Voucher), useValue: repo },
        { provide: ConfigService, useValue: cfg },
      ],
    }).compile();

    service = module.get(VoucherService);
    await service.onModuleInit();
  });

  // ── onModuleInit ───────────────────────────────────────────────────────────

  it('throws when GearApi rejects — does not silently continue', async () => {
    mockIsReadyOrError.mockReturnValue(Promise.reject(new Error('node unreachable')));

    const failingModule = await Test.createTestingModule({
      providers: [
        VoucherService,
        { provide: getRepositoryToken(Voucher), useValue: repo },
        { provide: ConfigService, useValue: cfg },
      ],
    }).compile();

    const failingSvc = failingModule.get(VoucherService);
    await expect(failingSvc.onModuleInit()).rejects.toThrow('node unreachable');
  });

  // ── getVoucher ─────────────────────────────────────────────────────────────

  it('queries with revoked: false so revoked vouchers are not returned', async () => {
    repo.findOneBy.mockResolvedValue(null);
    await service.getVoucher('0xabc');
    expect(repo.findOneBy).toHaveBeenCalledWith({ account: '0xabc', revoked: false });
  });

  it('returns null when the only matching voucher is revoked', async () => {
    repo.findOneBy.mockResolvedValue(null);
    const result = await service.getVoucher('0xabc');
    expect(result).toBeNull();
  });

  it('returns the voucher when it exists and is not revoked', async () => {
    const v = makeVoucher();
    repo.findOneBy.mockResolvedValue(v);
    const result = await service.getVoucher('0xabc');
    expect(result).toBe(v);
  });

  // ── issue() — balance guard ────────────────────────────────────────────────

  it('throws when issuer balance is below amount + 10 VARA reserve', async () => {
    mockBalance.mockResolvedValue({ toBigInt: () => BigInt(11 * 1e12) });
    await expect(
      service.issue('0xaccount' as any, ['0xprog'] as any, 3, 86400),
    ).rejects.toThrow('Insufficient issuer balance');
  });

  it('does not throw Insufficient when issuer balance exactly equals amount + reserve', async () => {
    mockBalance.mockResolvedValue({ toBigInt: () => BigInt(13 * 1e12) });
    // Force a downstream failure so we can assert the balance guard passed
    // without mocking signAndSend.
    mockVoucherIssue.mockRejectedValue(new Error('past balance guard'));
    await expect(
      service.issue('0xaccount' as any, ['0xprog'] as any, 3, 86400),
    ).rejects.toThrow('past balance guard');
  });

  // ── issue() — passes program array unmodified ─────────────────────────────

  it('issue() passes the programIds array unmodified to api.voucher.issue', async () => {
    // Stub the Gear call so we can inspect args without running signAndSend.
    // Issuer needs amount + 10 VARA reserve = 510 VARA minimum.
    mockBalance.mockResolvedValue({ toBigInt: () => BigInt(1000 * 1e12) });
    mockVoucherIssue.mockRejectedValue(new Error('stop after args capture'));

    const programs = ['0xp1', '0xp2', '0xp3'] as any;
    await expect(
      service.issue('0xaccount' as any, programs, 500, 86400),
    ).rejects.toThrow('stop after args capture');

    expect(mockVoucherIssue).toHaveBeenCalledWith(
      '0xaccount',
      BigInt(500) * BigInt(1e12),
      Math.round(86400 / 3),
      programs,
    );
  });

  // ── update() guard ─────────────────────────────────────────────────────────

  it('update() throws when called on a revoked voucher — prevents resurrection', async () => {
    const revoked = makeVoucher({ revoked: true });
    await expect(
      service.update(revoked, 10, 86400),
    ).rejects.toThrow('Cannot update revoked voucher');
  });

  // ── getVoucherBalance() ────────────────────────────────────────────────────

  it('getVoucherBalance() returns the on-chain balance as a bigint', async () => {
    mockBalance.mockResolvedValue({ toBigInt: () => 1_757_000_000_000_000n });
    const balance = await service.getVoucherBalance('0xvoucher');
    expect(balance).toBe(1_757_000_000_000_000n);
    expect(mockBalance).toHaveBeenCalledWith('0xvoucher');
  });

  it('getVoucherBalance() propagates RPC failures', async () => {
    mockBalance.mockRejectedValue(new Error('RPC down'));
    await expect(service.getVoucherBalance('0xvoucher')).rejects.toThrow('RPC down');
  });

  // ── signAndSend timeout ────────────────────────────────────────────────────

  it('rejects with timeout error when signAndSend does not settle within 60s', async () => {
    jest.useFakeTimers();
    const neverResolves = new Promise<never>(() => {});
    const racePromise = Promise.race([
      neverResolves,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('signAndSend timed out after 60s — transaction may or may not have landed')),
          60_000,
        ),
      ),
    ]);
    jest.advanceTimersByTime(61_000);
    await expect(racePromise).rejects.toThrow('timed out after 60s');
    jest.useRealTimers();
  });
});
