import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
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

const PROGRAM_A = '0x4d47cb784a0b1e3788181a6cedb52db11aad0cef';
const PROGRAM_B = '0xdeadbeef00000000000000000000000000000000';
const PROGRAM_C = '0xc0ffee00000000000000000000000000000000dd';
const ACCOUNT = 'validaccount';
const DECODED = `0x${ACCOUNT}`;
const IP = '127.0.0.1';
const TRANCHE_VARA = 500;
const TRANCHES_PER_IP = 40;
const TRANCHE_INTERVAL_SEC = 3600;
const TRANCHE_DURATION_SEC = 86400;

function makeProgram(address: string, overrides: Partial<GaslessProgram> = {}): GaslessProgram {
  return {
    id: `p-${address.slice(0, 6)}`,
    name: 'TestProgram',
    address,
    varaToIssue: TRANCHE_VARA,
    weight: 1,
    duration: TRANCHE_DURATION_SEC,
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
    programs: [PROGRAM_A],
    varaToIssue: TRANCHE_VARA,
    validUpToBlock: 1000n,
    validUpTo: new Date(Date.now() + TRANCHE_DURATION_SEC * 1000),
    lastRenewedAt: new Date(),
    revoked: false,
    ...overrides,
  } as Voucher;
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 3600_000);
}

// ── Setup ──────────────────────────────────────────────────────────────────────

describe('GaslessService (hourly-tranche model)', () => {
  let service: GaslessService;
  let voucherSvc: jest.Mocked<
    Pick<VoucherService, 'getVoucher' | 'issue' | 'update' | 'getVoucherBalance'>
  >;
  let programRepo: { findBy: jest.Mock; findOneBy: jest.Mock };
  let voucherRepo: Record<string, never>;
  let ds: { createQueryRunner: jest.Mock };
  let qrQuery: jest.Mock;
  let qrRelease: jest.Mock;
  let cfg: { get: jest.Mock };
  let cfgOverrides: Partial<Record<string, number | string>>;

  beforeEach(async () => {
    cfgOverrides = {};
    programRepo = {
      findBy: jest.fn().mockImplementation(async ({ address }) => {
        // `address` is a TypeORM `In([...])` FindOperator. We reach into its
        // internal value to let tests stub per-request program lists without
        // spinning up a real DB.
        //
        // WARNING: This couples to TypeORM's internal `_value`/`value`
        // property names. If TypeORM upgrades and rename/hide these fields,
        // this mock returns no results and the whole suite silently starts
        // hitting the "program not whitelisted" branch. If that happens,
        // update this extraction (or replace with a real in-memory DB).
        const addrs: string[] = address._value ?? address.value ?? [];
        return addrs.map((a) => makeProgram(a));
      }),
      findOneBy: jest.fn(),
    };
    voucherRepo = {};
    qrQuery = jest.fn().mockResolvedValue([]);
    qrRelease = jest.fn().mockResolvedValue(undefined);
    ds = {
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn().mockResolvedValue(undefined),
        query: qrQuery,
        release: qrRelease,
      }),
    };
    cfg = {
      get: jest.fn().mockImplementation((key: string) => {
        if (cfgOverrides[key] !== undefined) return cfgOverrides[key];
        if (key === 'hourlyTrancheVara') return TRANCHE_VARA;
        if (key === 'perIpTranchesPerDay') return TRANCHES_PER_IP;
        if (key === 'trancheIntervalSec') return TRANCHE_INTERVAL_SEC;
        if (key === 'trancheDurationSec') return TRANCHE_DURATION_SEC;
        return undefined;
      }),
    };
    voucherSvc = {
      getVoucher: jest.fn().mockResolvedValue(null),
      issue: jest.fn().mockResolvedValue('0xnewvoucher'),
      update: jest.fn().mockResolvedValue(undefined),
      getVoucherBalance: jest.fn().mockResolvedValue(0n),
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
  });

  // ── Input / DTO validation ────────────────────────────────────────────────

  it('throws 400 for invalid account address', async () => {
    await expect(
      service.requestVoucher({ account: 'invalid', programs: [PROGRAM_A] }, IP),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 400 when programs array is empty', async () => {
    await expect(
      service.requestVoucher({ account: ACCOUNT, programs: [] }, IP),
    ).rejects.toThrow(/non-empty/);
  });

  it('throws 400 naming the program when one is not whitelisted', async () => {
    programRepo.findBy.mockResolvedValue([makeProgram(PROGRAM_A)]);
    await expect(
      service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A, PROGRAM_B] }, IP),
    ).rejects.toThrow(new RegExp(PROGRAM_B.slice(2, 10)));
  });

  it('throws 400 naming the program when one is disabled', async () => {
    programRepo.findBy.mockResolvedValue([
      makeProgram(PROGRAM_A),
      makeProgram(PROGRAM_B, { status: GaslessProgramStatus.Disabled }),
    ]);
    await expect(
      service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A, PROGRAM_B] }, IP),
    ).rejects.toThrow(new RegExp(PROGRAM_B.slice(2, 10)));
  });

  it('lowercases programs before whitelist lookup and passes lowercase to issue()', async () => {
    voucherSvc.getVoucher.mockResolvedValue(null);
    await service.requestVoucher(
      { account: ACCOUNT, programs: [PROGRAM_A.toUpperCase()] },
      IP,
    );
    const lookupArg = (programRepo.findBy.mock.calls[0][0] as any).address;
    const lookedUp: string[] = lookupArg._value ?? lookupArg.value;
    expect(lookedUp).toEqual([PROGRAM_A]);
    expect(voucherSvc.issue).toHaveBeenCalledWith(
      DECODED,
      [PROGRAM_A],
      TRANCHE_VARA,
      TRANCHE_DURATION_SEC,
    );
  });

  it('dedupes programs array before whitelist lookup', async () => {
    voucherSvc.getVoucher.mockResolvedValue(null);
    await service.requestVoucher(
      { account: ACCOUNT, programs: [PROGRAM_A, PROGRAM_A, PROGRAM_B] },
      IP,
    );
    expect(voucherSvc.issue).toHaveBeenCalledWith(
      DECODED,
      [PROGRAM_A, PROGRAM_B],
      TRANCHE_VARA,
      TRANCHE_DURATION_SEC,
    );
  });

  // ── oneTime across batch ───────────────────────────────────────────────────

  it('throws 400 naming the oneTime program already in existing voucher', async () => {
    programRepo.findBy.mockResolvedValue([
      makeProgram(PROGRAM_A, { oneTime: true }),
    ]);
    voucherSvc.getVoucher.mockResolvedValue(
      makeVoucher({ programs: [PROGRAM_A], lastRenewedAt: hoursAgo(2) }),
    );
    await expect(
      service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A] }, IP),
    ).rejects.toThrow(/One-time/);
  });

  it('allows oneTime program when not yet in voucher', async () => {
    programRepo.findBy.mockResolvedValue([
      makeProgram(PROGRAM_A, { oneTime: true }),
    ]);
    voucherSvc.getVoucher.mockResolvedValue(
      makeVoucher({ programs: [PROGRAM_B], lastRenewedAt: hoursAgo(2) }),
    );
    await expect(
      service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A] }, IP),
    ).resolves.toEqual({ status: 'ok', voucherId: '0xvoucher' });
  });

  // ── Advisory lock ──────────────────────────────────────────────────────────

  it('acquires + releases pg advisory lock on success', async () => {
    voucherSvc.getVoucher.mockResolvedValue(null);
    await service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A] }, IP);
    const calls = qrQuery.mock.calls.map((c) => c[0]);
    expect(calls).toContain('SELECT pg_advisory_lock($1)');
    expect(calls).toContain('SELECT pg_advisory_unlock($1)');
    expect(qrRelease).toHaveBeenCalled();
  });

  it('lock key is account-hash only (stable across midnight step)', async () => {
    voucherSvc.getVoucher.mockResolvedValue(null);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-22T23:59:58Z').getTime());
    await service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A] }, IP);
    const firstKey = qrQuery.mock.calls.filter((c) =>
      c[0] === 'SELECT pg_advisory_lock($1)',
    )[0][1][0];
    qrQuery.mockClear();
    voucherSvc.getVoucher.mockResolvedValue(
      makeVoucher({ lastRenewedAt: new Date(Date.now() - 2 * 3600_000) }),
    );
    jest.setSystemTime(new Date('2026-04-23T00:00:05Z').getTime());
    await service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A] }, IP);
    const secondKey = qrQuery.mock.calls.filter((c) =>
      c[0] === 'SELECT pg_advisory_lock($1)',
    )[0][1][0];
    expect(firstKey).toBe(secondKey);
    jest.useRealTimers();
  });

  it('releases lock even when issue() throws', async () => {
    voucherSvc.getVoucher.mockResolvedValue(null);
    voucherSvc.issue.mockRejectedValue(new Error('chain error'));
    await expect(
      service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A] }, IP),
    ).rejects.toThrow(InternalServerErrorException);
    const calls = qrQuery.mock.calls.map((c) => c[0]);
    expect(calls).toContain('SELECT pg_advisory_unlock($1)');
    expect(qrRelease).toHaveBeenCalled();
  });

  it('releases QueryRunner even when lock acquisition fails', async () => {
    qrQuery.mockRejectedValueOnce(new Error('DB connection lost'));
    voucherSvc.getVoucher.mockResolvedValue(null);
    await expect(
      service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A] }, IP),
    ).rejects.toThrow();
    expect(qrRelease).toHaveBeenCalled();
  });

  // ── Branch (a): no existing voucher ───────────────────────────────────────

  it('issues a fresh voucher with full programs array and charges +1 tranche', async () => {
    voucherSvc.getVoucher.mockResolvedValue(null);
    const result = await service.requestVoucher(
      { account: ACCOUNT, programs: [PROGRAM_A, PROGRAM_B, PROGRAM_C] },
      IP,
    );
    expect(voucherSvc.issue).toHaveBeenCalledWith(
      DECODED,
      [PROGRAM_A, PROGRAM_B, PROGRAM_C],
      TRANCHE_VARA,
      TRANCHE_DURATION_SEC,
    );
    expect(voucherSvc.update).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'ok', voucherId: '0xnewvoucher' });
  });

  // ── Branch (b): existing voucher past 1h ──────────────────────────────────

  it('tops up existing voucher when >1h since last renewal', async () => {
    const existing = makeVoucher({
      programs: [PROGRAM_A],
      lastRenewedAt: hoursAgo(2),
    });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    await service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A] }, IP);
    expect(voucherSvc.update).toHaveBeenCalledWith(
      existing,
      TRANCHE_VARA,
      TRANCHE_DURATION_SEC,
      undefined,
    );
  });

  it('top-up filters to only NEW programs (subset already registered)', async () => {
    const existing = makeVoucher({
      programs: [PROGRAM_A],
      lastRenewedAt: hoursAgo(2),
    });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    await service.requestVoucher(
      { account: ACCOUNT, programs: [PROGRAM_A, PROGRAM_B] },
      IP,
    );
    expect(voucherSvc.update).toHaveBeenCalledWith(
      existing,
      TRANCHE_VARA,
      TRANCHE_DURATION_SEC,
      [PROGRAM_B],
    );
  });

  it('top-up passes undefined for addPrograms when no new programs', async () => {
    const existing = makeVoucher({
      programs: [PROGRAM_A, PROGRAM_B],
      lastRenewedAt: hoursAgo(2),
    });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    await service.requestVoucher(
      { account: ACCOUNT, programs: [PROGRAM_A, PROGRAM_B] },
      IP,
    );
    expect(voucherSvc.update).toHaveBeenCalledWith(
      existing,
      TRANCHE_VARA,
      TRANCHE_DURATION_SEC,
      undefined,
    );
  });

  // ── Branch (c): within 1h → 429 ───────────────────────────────────────────

  it('returns rate-limited result when within 1h with Retry-After seconds', async () => {
    jest.useFakeTimers();
    const now = new Date('2026-04-22T12:00:00Z');
    jest.setSystemTime(now.getTime());
    const lastRenewed = new Date(now.getTime() - 20 * 60_000); // 20 min ago
    voucherSvc.getVoucher.mockResolvedValue(
      makeVoucher({ lastRenewedAt: lastRenewed }),
    );
    const result = await service.requestVoucher(
      { account: ACCOUNT, programs: [PROGRAM_A] },
      IP,
    );
    expect(result.status).toBe('rate_limited');
    if (result.status !== 'rate_limited') throw new Error('expected rate_limited');
    expect(result.retryAfterSec).toBe(40 * 60); // 40 min remaining
    expect(result.body.statusCode).toBe(429);
    expect(result.body.nextEligibleAt).toBe(
      new Date(lastRenewed.getTime() + 3600_000).toISOString(),
    );
    expect(result.body.retryAfterSec).toBe(40 * 60);
    expect(voucherSvc.issue).not.toHaveBeenCalled();
    expect(voucherSvc.update).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('rate-limited path does NOT charge the IP tranche ceiling', async () => {
    cfgOverrides.perIpTranchesPerDay = 2;
    voucherSvc.getVoucher.mockResolvedValue(
      makeVoucher({ lastRenewedAt: hoursAgo(0.1) }),
    );
    // Fire 5 same-wallet requests — all hit 429, none should charge tranches.
    for (let i = 0; i < 5; i++) {
      const r = await service.requestVoucher(
        { account: ACCOUNT, programs: [PROGRAM_A] },
        IP,
      );
      expect(r.status).toBe('rate_limited');
    }
    // A fresh-account request should still succeed (ceiling still has budget).
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    const ok = await service.requestVoucher(
      { account: 'fresh1', programs: [PROGRAM_A] },
      IP,
    );
    expect(ok.status).toBe('ok');
  });

  // ── Per-IP tranche count ceiling ──────────────────────────────────────────

  it('enforces per-IP tranche ceiling (41st charge rejected)', async () => {
    cfgOverrides.perIpTranchesPerDay = 3;
    for (let i = 0; i < 3; i++) {
      voucherSvc.getVoucher.mockResolvedValueOnce(null);
      await expect(
        service.requestVoucher(
          { account: `fresh${i}`, programs: [PROGRAM_A] },
          IP,
        ),
      ).resolves.toMatchObject({ status: 'ok' });
    }
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    await expect(
      service.requestVoucher(
        { account: 'overflow', programs: [PROGRAM_A] },
        IP,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('ceiling is scoped per-IP — different IP gets its own budget', async () => {
    cfgOverrides.perIpTranchesPerDay = 2;
    for (let i = 0; i < 2; i++) {
      voucherSvc.getVoucher.mockResolvedValueOnce(null);
      await service.requestVoucher(
        { account: `a${i}`, programs: [PROGRAM_A] },
        IP,
      );
    }
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    await expect(
      service.requestVoucher(
        { account: 'other', programs: [PROGRAM_A] },
        '10.0.0.2',
      ),
    ).resolves.toMatchObject({ status: 'ok' });
  });

  // ── Per-IP ceiling race safety ────────────────────────────────────────────

  it('per-IP tranche count is race-safe for concurrent same-IP different-account requests', async () => {
    jest.setTimeout(15000);
    cfgOverrides.perIpTranchesPerDay = 1;
    let resolveFirst: (v: string) => void = () => {};
    let resolveSecond: (v: string) => void = () => {};
    voucherSvc.getVoucher.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    voucherSvc.issue
      .mockImplementationOnce(
        () => new Promise<string>((r) => { resolveFirst = r; }),
      )
      .mockImplementationOnce(
        () => new Promise<string>((r) => { resolveSecond = r; }),
      );

    const req1 = service.requestVoucher({ account: 'racer1', programs: [PROGRAM_A] }, IP);
    const req2 = service.requestVoucher({ account: 'racer2', programs: [PROGRAM_A] }, IP);
    req1.catch(() => {});
    req2.catch(() => {});

    await new Promise((r) => setImmediate(r));
    resolveFirst('0xnewvoucher1');
    resolveSecond('0xnewvoucher2');

    const results = await Promise.allSettled([req1, req2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('per-IP reservation is NOT refunded when issue() fails (double-mint defense)', async () => {
    cfgOverrides.perIpTranchesPerDay = 3;
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    voucherSvc.issue.mockRejectedValueOnce(new Error('chain down'));
    await expect(
      service.requestVoucher({ account: 'willfail', programs: [PROGRAM_A] }, IP),
    ).rejects.toThrow();

    // Two more successes (uses 2/3 remaining). Then overflow.
    for (let i = 0; i < 2; i++) {
      voucherSvc.getVoucher.mockResolvedValueOnce(null);
      await service.requestVoucher(
        { account: `post${i}`, programs: [PROGRAM_A] },
        IP,
      );
    }
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    await expect(
      service.requestVoucher({ account: 'overflow', programs: [PROGRAM_A] }, IP),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  // ── CRITICAL regression: mid-cycle migration ──────────────────────────────
  // Guards against a silent re-introduction of "top up to target" semantic.
  // Existing voucher with lastRenewedAt > 1h ago must get +500 exactly,
  // regardless of any on-chain balance reading.

  it('CRITICAL: mid-cycle migration calls update() with amountToAdd=500, NOT a diff', async () => {
    const existing = makeVoucher({
      programs: [PROGRAM_A],
      lastRenewedAt: hoursAgo(25), // old 2000-VARA voucher from yesterday
    });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    // Even though on-chain balance might be 1800 VARA, update() receives 500.
    voucherSvc.getVoucherBalance.mockResolvedValue(1800n * 10n ** 12n);
    await service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A] }, IP);
    expect(voucherSvc.update).toHaveBeenCalledWith(
      existing,
      500, // NOT (500 - 1800) = -1300; NOT "top up to 500"; always +500
      TRANCHE_DURATION_SEC,
      undefined,
    );
  });

  // ── getVoucherState ────────────────────────────────────────────────────────

  it('getVoucherState returns null + canTopUpNow=true for unknown account', async () => {
    voucherSvc.getVoucher.mockResolvedValue(null);
    const state = await service.getVoucherState(ACCOUNT);
    expect(state).toEqual({
      voucherId: null,
      programs: [],
      validUpTo: null,
      varaBalance: '0',
      balanceKnown: true,
      lastRenewedAt: null,
      nextTopUpEligibleAt: null,
      canTopUpNow: true,
    });
  });

  it('getVoucherState returns canTopUpNow=false when within 1h', async () => {
    const existing = makeVoucher({ lastRenewedAt: hoursAgo(0.5) });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    voucherSvc.getVoucherBalance.mockResolvedValue(1500n);
    const state = await service.getVoucherState(ACCOUNT);
    expect(state.canTopUpNow).toBe(false);
    expect(state.lastRenewedAt).toBe(existing.lastRenewedAt.toISOString());
    expect(state.nextTopUpEligibleAt).toBe(
      new Date(existing.lastRenewedAt.getTime() + 3600_000).toISOString(),
    );
    expect(state.varaBalance).toBe('1500');
  });

  it('getVoucherState returns canTopUpNow=true when >1h and clamps nextTopUpEligibleAt to now', async () => {
    voucherSvc.getVoucher.mockResolvedValue(
      makeVoucher({ lastRenewedAt: hoursAgo(5) }),
    );
    voucherSvc.getVoucherBalance.mockResolvedValue(1500n);
    const before = Date.now();
    const state = await service.getVoucherState(ACCOUNT);
    const after = Date.now();
    expect(state.canTopUpNow).toBe(true);
    // nextTopUpEligibleAt must be clamped to "now", not 5h-ago + 1h = 4h in the past.
    const returned = new Date(state.nextTopUpEligibleAt!).getTime();
    expect(returned).toBeGreaterThanOrEqual(before);
    expect(returned).toBeLessThanOrEqual(after);
  });

  it('getVoucherState reports balanceKnown=false on RPC failure (ported)', async () => {
    voucherSvc.getVoucher.mockResolvedValue(
      makeVoucher({ lastRenewedAt: hoursAgo(0.5) }),
    );
    voucherSvc.getVoucherBalance.mockRejectedValue(new Error('RPC down'));
    const state = await service.getVoucherState(ACCOUNT);
    expect(state.varaBalance).toBe(null);
    expect(state.balanceKnown).toBe(false);
  });

  it('getVoucherState throws 400 for invalid address', async () => {
    await expect(service.getVoucherState('invalid')).rejects.toThrow(BadRequestException);
  });

  // ── Error wrapping ─────────────────────────────────────────────────────────

  it('wraps chain errors as 500 InternalServerErrorException', async () => {
    voucherSvc.getVoucher.mockResolvedValue(null);
    voucherSvc.issue.mockRejectedValue(new Error('RPC timeout'));
    await expect(
      service.requestVoucher({ account: ACCOUNT, programs: [PROGRAM_A] }, IP),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('passes HttpException (ceiling) through without wrapping as 500', async () => {
    cfgOverrides.perIpTranchesPerDay = 1;
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    await service.requestVoucher({ account: 'a0', programs: [PROGRAM_A] }, IP);
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    await expect(
      service.requestVoucher({ account: 'a1', programs: [PROGRAM_A] }, IP),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
