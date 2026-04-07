import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import { GaslessService } from './gasless.service';
import { VoucherService } from './voucher.service';
import { GaslessProgram, GaslessProgramStatus } from '../entities/gasless-program.entity';
import { Voucher } from '../entities/voucher.entity';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@gear-js/api', () => ({
  decodeAddress: jest.fn((addr: string) => {
    if (addr === 'invalid') throw new Error('Invalid address');
    return `0x${addr}`;
  }),
}));

const PROGRAM = '0x4d47cb784a0b1e3788181a6cedb52db11aad0cef';
const OTHER_PROGRAM = '0xdeadbeef00000000000000000000000000000000';
const ACCOUNT = 'validaccount';
const DECODED = `0x${ACCOUNT}`;

function makeProgram(overrides: Partial<GaslessProgram> = {}): GaslessProgram {
  return {
    id: 'p1',
    name: 'BasketMarket',
    address: PROGRAM,
    varaToIssue: 3,
    duration: 86400,
    status: GaslessProgramStatus.Enabled,
    oneTime: false,
    createdAt: new Date(),
    ...overrides,
  } as GaslessProgram;
}

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 'v1',
    voucherId: '0xvoucher',
    account: DECODED,
    programs: [PROGRAM],
    varaToIssue: 3,
    validUpToBlock: 1000n,
    validUpTo: new Date(Date.now() + 86400_000),
    lastRenewedAt: new Date(),
    revoked: false,
    ...overrides,
  } as Voucher;
}

// ── Setup ──────────────────────────────────────────────────────────────────────

describe('GaslessService', () => {
  let service: GaslessService;
  let voucherSvc: jest.Mocked<Pick<VoucherService, 'getVoucher' | 'issue' | 'update'>>;
  let programRepo: { findOneBy: jest.Mock };
  let voucherRepo: { createQueryBuilder: jest.Mock };
  let ds: { query: jest.Mock };
  let cfg: { get: jest.Mock };

  beforeEach(async () => {
    let qbTotal = '0';
    const qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockImplementation(() =>
        Promise.resolve({ total: qbTotal }),
      ),
    };

    programRepo = { findOneBy: jest.fn().mockResolvedValue(makeProgram()) };
    voucherRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    ds = { query: jest.fn().mockResolvedValue([]) };
    cfg = {
      get: jest.fn().mockImplementation((key: string) =>
        key === 'dailyVaraCap' ? 100 : undefined,
      ),
    };
    voucherSvc = {
      getVoucher: jest.fn().mockResolvedValue(null),
      issue: jest.fn().mockResolvedValue('0xnewvoucher'),
      update: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        GaslessService,
        { provide: VoucherService, useValue: voucherSvc },
        { provide: ConfigService, useValue: cfg },
        { provide: DataSource, useValue: ds },
        { provide: getRepositoryToken(GaslessProgram), useValue: programRepo },
        { provide: getRepositoryToken(Voucher), useValue: voucherRepo },
      ],
    }).compile();

    service = module.get(GaslessService);

    // Helper to set today's total for a test
    (service as any)._setTodayTotal = (n: number) => {
      qbTotal = String(n);
    };
  });

  // ── Input validation ───────────────────────────────────────────────────────

  it('throws 400 for invalid account address', async () => {
    await expect(
      service.requestVoucher({ account: 'invalid', program: PROGRAM }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.requestVoucher({ account: 'invalid', program: PROGRAM }),
    ).rejects.toThrow('Invalid account address');
  });

  it('throws 400 when program not in whitelist', async () => {
    programRepo.findOneBy.mockResolvedValue(null);
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 400 when program is disabled', async () => {
    programRepo.findOneBy.mockResolvedValue(
      makeProgram({ status: GaslessProgramStatus.Disabled }),
    );
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }),
    ).rejects.toThrow(BadRequestException);
  });

  it('normalizes program address to lowercase before DB lookup', async () => {
    await service.requestVoucher({ account: ACCOUNT, program: PROGRAM.toUpperCase() });
    expect(programRepo.findOneBy).toHaveBeenCalledWith({
      address: PROGRAM.toLowerCase(),
    });
  });

  // ── oneTime logic ──────────────────────────────────────────────────────────

  it('throws 400 when oneTime program is already in existing voucher', async () => {
    programRepo.findOneBy.mockResolvedValue(makeProgram({ oneTime: true }));
    voucherSvc.getVoucher.mockResolvedValue(makeVoucher({ programs: [PROGRAM] }));
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }),
    ).rejects.toThrow('One-time voucher already issued');
  });

  it('does NOT block oneTime request when existing voucher covers a different program', async () => {
    // Bug regression: existing voucher for OTHER_PROGRAM must not block oneTime PROGRAM.
    // Because existing is non-null, it goes to update() which adds PROGRAM to the voucher.
    programRepo.findOneBy.mockResolvedValue(makeProgram({ oneTime: true }));
    const existing = makeVoucher({ programs: [OTHER_PROGRAM] });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    const result = await service.requestVoucher({ account: ACCOUNT, program: PROGRAM });
    // Should update (not issue) since a voucher exists — adds the new program to it
    expect(voucherSvc.issue).not.toHaveBeenCalled();
    expect(voucherSvc.update).toHaveBeenCalledWith(existing, 3, 86400, [PROGRAM]);
    expect(result).toEqual({ voucherId: '0xvoucher' });
  });

  it('does NOT block when oneTime=false and voucher already exists', async () => {
    programRepo.findOneBy.mockResolvedValue(makeProgram({ oneTime: false }));
    voucherSvc.getVoucher.mockResolvedValue(makeVoucher());
    const result = await service.requestVoucher({ account: ACCOUNT, program: PROGRAM });
    expect(result).toEqual({ voucherId: '0xvoucher' });
  });

  // ── Daily cap ──────────────────────────────────────────────────────────────

  it('throws 400 when daily cap is exceeded', async () => {
    (service as any)._setTodayTotal(99); // 99 + 3 > 100
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }),
    ).rejects.toThrow('Daily voucher budget exhausted');
  });

  it('allows request when todayTotal + amount equals cap exactly (boundary inclusive)', async () => {
    (service as any)._setTodayTotal(97); // 97 + 3 = 100, not > 100
    const result = await service.requestVoucher({ account: ACCOUNT, program: PROGRAM });
    expect(result).toEqual({ voucherId: '0xnewvoucher' });
  });

  it('allows request when budget is completely fresh (todayTotal = 0)', async () => {
    const result = await service.requestVoucher({ account: ACCOUNT, program: PROGRAM });
    expect(result).toEqual({ voucherId: '0xnewvoucher' });
  });

  // ── Happy paths ────────────────────────────────────────────────────────────

  it('issues new voucher when account has no existing voucher', async () => {
    voucherSvc.getVoucher.mockResolvedValue(null);
    const result = await service.requestVoucher({ account: ACCOUNT, program: PROGRAM });
    expect(voucherSvc.issue).toHaveBeenCalledWith(DECODED, PROGRAM, 3, 86400);
    expect(result).toEqual({ voucherId: '0xnewvoucher' });
  });

  it('renews existing voucher when program is already in voucher', async () => {
    const existing = makeVoucher({ programs: [PROGRAM] });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    const result = await service.requestVoucher({ account: ACCOUNT, program: PROGRAM });
    expect(voucherSvc.update).toHaveBeenCalledWith(existing, 3, 86400);
    expect(voucherSvc.issue).not.toHaveBeenCalled();
    expect(result).toEqual({ voucherId: '0xvoucher' });
  });

  it('appends program to existing voucher when program is new', async () => {
    const existing = makeVoucher({ programs: [OTHER_PROGRAM] });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    programRepo.findOneBy.mockResolvedValue(makeProgram({ address: PROGRAM }));
    await service.requestVoucher({ account: ACCOUNT, program: PROGRAM });
    expect(voucherSvc.update).toHaveBeenCalledWith(existing, 3, 86400, [PROGRAM]);
  });

  // ── Advisory lock ──────────────────────────────────────────────────────────

  it('acquires pg advisory lock before cap check', async () => {
    await service.requestVoucher({ account: ACCOUNT, program: PROGRAM });
    const calls = ds.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain('SELECT pg_advisory_lock($1)');
  });

  it('releases pg advisory lock after successful issuance', async () => {
    await service.requestVoucher({ account: ACCOUNT, program: PROGRAM });
    const calls = ds.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain('SELECT pg_advisory_unlock($1)');
  });

  it('releases pg advisory lock even when issuance throws', async () => {
    voucherSvc.issue.mockRejectedValue(new Error('chain error'));
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }),
    ).rejects.toThrow(BadRequestException);
    const calls = ds.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain('SELECT pg_advisory_unlock($1)');
  });

  it('wraps unexpected errors as BadRequestException', async () => {
    voucherSvc.issue.mockRejectedValue(new Error('RPC timeout'));
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }),
    ).rejects.toThrow(BadRequestException);
  });
});
