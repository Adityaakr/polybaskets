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

const PROGRAM = '0x4d47cb784a0b1e3788181a6cedb52db11aad0cef';
const OTHER_PROGRAM = '0xdeadbeef00000000000000000000000000000000';
const ACCOUNT = 'validaccount';
const DECODED = `0x${ACCOUNT}`;
const IP = '127.0.0.1';
const DAILY_CAP = 2000;
const IP_CEILING = 20000;

function makeProgram(overrides: Partial<GaslessProgram> = {}): GaslessProgram {
  return {
    id: 'p1',
    name: 'BasketMarket',
    address: PROGRAM,
    varaToIssue: DAILY_CAP,
    weight: 1,
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
    varaToIssue: DAILY_CAP,
    validUpToBlock: 1000n,
    validUpTo: new Date(Date.now() + 86400_000),
    lastRenewedAt: new Date(),
    revoked: false,
    ...overrides,
  } as Voucher;
}

function yesterdayMidnightMinusOneSec(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCSeconds(d.getUTCSeconds() - 1);
  return d;
}

// ── Setup ──────────────────────────────────────────────────────────────────────

describe('GaslessService (Path B)', () => {
  let service: GaslessService;
  let voucherSvc: jest.Mocked<
    Pick<VoucherService, 'getVoucher' | 'issue' | 'update' | 'appendProgramOnly' | 'getVoucherBalance'>
  >;
  let programRepo: { findOneBy: jest.Mock };
  let voucherRepo: Record<string, never>;
  let ds: { createQueryRunner: jest.Mock };
  let qrQuery: jest.Mock;
  let qrRelease: jest.Mock;
  let cfg: { get: jest.Mock };

  beforeEach(async () => {
    programRepo = {
      findOneBy: jest.fn().mockResolvedValue(makeProgram()),
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
        if (key === 'dailyVaraCap') return DAILY_CAP;
        if (key === 'perIpDailyVaraCeiling') return IP_CEILING;
        return undefined;
      }),
    };
    voucherSvc = {
      getVoucher: jest.fn().mockResolvedValue(null),
      issue: jest.fn().mockResolvedValue('0xnewvoucher'),
      update: jest.fn().mockResolvedValue(undefined),
      appendProgramOnly: jest.fn().mockResolvedValue(undefined),
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

  // ── Input validation ───────────────────────────────────────────────────────

  it('throws 400 for invalid account address', async () => {
    await expect(
      service.requestVoucher({ account: 'invalid', program: PROGRAM }, IP),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 400 when program not in whitelist', async () => {
    programRepo.findOneBy.mockResolvedValue(null);
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 400 when program is disabled', async () => {
    programRepo.findOneBy.mockResolvedValue(
      makeProgram({ status: GaslessProgramStatus.Disabled }),
    );
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP),
    ).rejects.toThrow(BadRequestException);
  });

  it('normalizes program address to lowercase before DB lookup', async () => {
    await service.requestVoucher({ account: ACCOUNT, program: PROGRAM.toUpperCase() }, IP);
    expect(programRepo.findOneBy).toHaveBeenCalledWith({
      address: PROGRAM.toLowerCase(),
    });
  });

  // ── oneTime logic ──────────────────────────────────────────────────────────

  it('throws 400 when oneTime program is already in existing voucher', async () => {
    programRepo.findOneBy.mockResolvedValue(makeProgram({ oneTime: true }));
    voucherSvc.getVoucher.mockResolvedValue(makeVoucher({ programs: [PROGRAM] }));
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP),
    ).rejects.toThrow('One-time voucher already issued');
  });

  it('allows oneTime for a different program even when another is present', async () => {
    // Voucher exists for OTHER_PROGRAM, funded today, so append-only path runs.
    programRepo.findOneBy.mockResolvedValue(makeProgram({ oneTime: true }));
    const existing = makeVoucher({
      programs: [OTHER_PROGRAM],
      lastRenewedAt: new Date(),
    });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    const result = await service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP);
    expect(voucherSvc.issue).not.toHaveBeenCalled();
    expect(voucherSvc.update).not.toHaveBeenCalled(); // funded today, no top-up
    expect(voucherSvc.appendProgramOnly).toHaveBeenCalledWith(existing, PROGRAM);
    expect(result).toEqual({ voucherId: '0xvoucher' });
  });

  // ── Path B daily-gate branches ─────────────────────────────────────────────

  it('issues a brand-new voucher at dailyCap when no row exists', async () => {
    voucherSvc.getVoucher.mockResolvedValue(null);
    const result = await service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP);
    expect(voucherSvc.issue).toHaveBeenCalledWith(DECODED, PROGRAM, DAILY_CAP, 86400);
    expect(voucherSvc.update).not.toHaveBeenCalled();
    expect(voucherSvc.appendProgramOnly).not.toHaveBeenCalled();
    expect(result).toEqual({ voucherId: '0xnewvoucher' });
  });

  it('tops up existing voucher when lastRenewedAt is yesterday (first POST of a new UTC day)', async () => {
    const existing = makeVoucher({
      programs: [PROGRAM],
      lastRenewedAt: yesterdayMidnightMinusOneSec(),
    });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    const result = await service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP);
    expect(voucherSvc.update).toHaveBeenCalledWith(existing, DAILY_CAP, 86400, undefined);
    expect(voucherSvc.appendProgramOnly).not.toHaveBeenCalled();
    expect(result).toEqual({ voucherId: '0xvoucher' });
  });

  it('tops up AND appends program when program is new and voucher is stale', async () => {
    const existing = makeVoucher({
      programs: [OTHER_PROGRAM],
      lastRenewedAt: yesterdayMidnightMinusOneSec(),
    });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    await service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP);
    expect(voucherSvc.update).toHaveBeenCalledWith(existing, DAILY_CAP, 86400, [PROGRAM]);
  });

  it('same-day POST for a NEW program: append-only, no balance change', async () => {
    const existing = makeVoucher({
      programs: [OTHER_PROGRAM],
      lastRenewedAt: new Date(),
    });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    const result = await service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP);
    expect(voucherSvc.appendProgramOnly).toHaveBeenCalledWith(existing, PROGRAM);
    expect(voucherSvc.update).not.toHaveBeenCalled();
    expect(voucherSvc.issue).not.toHaveBeenCalled();
    expect(result).toEqual({ voucherId: '0xvoucher' });
  });

  it('same-day POST for SAME program: no-op, returns same voucherId', async () => {
    const existing = makeVoucher({
      programs: [PROGRAM],
      lastRenewedAt: new Date(),
    });
    voucherSvc.getVoucher.mockResolvedValue(existing);
    const result = await service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP);
    expect(voucherSvc.appendProgramOnly).not.toHaveBeenCalled();
    expect(voucherSvc.update).not.toHaveBeenCalled();
    expect(voucherSvc.issue).not.toHaveBeenCalled();
    expect(result).toEqual({ voucherId: '0xvoucher' });
  });

  // ── Per-IP daily VARA ceiling ─────────────────────────────────────────────

  it('allows issuance up to the per-IP ceiling', async () => {
    // Ten fresh addresses from same IP, each gets a full dailyCap voucher.
    // 10 × 2000 = 20000 = ceiling exactly.
    for (let i = 0; i < 10; i++) {
      voucherSvc.getVoucher.mockResolvedValueOnce(null);
      await expect(
        service.requestVoucher({ account: `fresh${i}`, program: PROGRAM }, IP),
      ).resolves.toBeDefined();
    }
    expect(voucherSvc.issue).toHaveBeenCalledTimes(10);
  });

  it('rejects the next issuance once per-IP ceiling is reached', async () => {
    for (let i = 0; i < 10; i++) {
      voucherSvc.getVoucher.mockResolvedValueOnce(null);
      await service.requestVoucher({ account: `fresh${i}`, program: PROGRAM }, IP);
    }
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    await expect(
      service.requestVoucher({ account: 'eleventh', program: PROGRAM }, IP),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('append-only path does NOT charge the IP ceiling', async () => {
    // Pre-fund the IP up to ceiling minus headroom.
    for (let i = 0; i < 10; i++) {
      voucherSvc.getVoucher.mockResolvedValueOnce(null);
      await service.requestVoucher({ account: `fresh${i}`, program: PROGRAM }, IP);
    }
    // Now an append-only request from same IP must succeed (no cap charge).
    const existing = makeVoucher({ programs: [OTHER_PROGRAM], lastRenewedAt: new Date() });
    voucherSvc.getVoucher.mockResolvedValueOnce(existing);
    await expect(
      service.requestVoucher({ account: 'someoneelse', program: PROGRAM }, IP),
    ).resolves.toEqual({ voucherId: '0xvoucher' });
  });

  it('ceiling is scoped per-IP — different IP gets its own budget', async () => {
    for (let i = 0; i < 10; i++) {
      voucherSvc.getVoucher.mockResolvedValueOnce(null);
      await service.requestVoucher({ account: `a${i}`, program: PROGRAM }, IP);
    }
    // Second IP is fresh.
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    await expect(
      service.requestVoucher({ account: 'otheraccount', program: PROGRAM }, '10.0.0.2'),
    ).resolves.toBeDefined();
  });

  // ── Advisory lock ──────────────────────────────────────────────────────────

  it('acquires pg advisory lock via QueryRunner before issuing', async () => {
    await service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP);
    const calls = qrQuery.mock.calls.map((c) => c[0]);
    expect(calls).toContain('SELECT pg_advisory_lock($1)');
  });

  it('releases pg advisory lock and releases QueryRunner after success', async () => {
    await service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP);
    const calls = qrQuery.mock.calls.map((c) => c[0]);
    expect(calls).toContain('SELECT pg_advisory_unlock($1)');
    expect(qrRelease).toHaveBeenCalled();
  });

  it('lock/unlock use the SAME key captured before async work (midnight stability)', async () => {
    await service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP);
    const lockArgs = qrQuery.mock.calls
      .filter((c) => c[0] === 'SELECT pg_advisory_lock($1)' || c[0] === 'SELECT pg_advisory_unlock($1)')
      .map((c) => c[1][0]);
    expect(lockArgs.length).toBe(2);
    expect(lockArgs[0]).toBe(lockArgs[1]); // same key used for both
  });

  it('releases pg advisory lock and QueryRunner even when issuance throws', async () => {
    voucherSvc.issue.mockRejectedValue(new Error('chain error'));
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP),
    ).rejects.toThrow(InternalServerErrorException);
    const calls = qrQuery.mock.calls.map((c) => c[0]);
    expect(calls).toContain('SELECT pg_advisory_unlock($1)');
    expect(qrRelease).toHaveBeenCalled();
  });

  it('wraps infrastructure errors as 500 InternalServerErrorException', async () => {
    voucherSvc.issue.mockRejectedValue(new Error('RPC timeout'));
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('passes HttpException (ceiling) through without wrapping as 500', async () => {
    // Pre-fill ceiling
    for (let i = 0; i < 10; i++) {
      voucherSvc.getVoucher.mockResolvedValueOnce(null);
      await service.requestVoucher({ account: `a${i}`, program: PROGRAM }, IP);
    }
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    await expect(
      service.requestVoucher({ account: 'next', program: PROGRAM }, IP),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('releases QueryRunner even when lock acquisition fails', async () => {
    qrQuery.mockRejectedValueOnce(new Error('DB connection lost'));
    await expect(
      service.requestVoucher({ account: ACCOUNT, program: PROGRAM }, IP),
    ).rejects.toThrow();
    expect(qrRelease).toHaveBeenCalled();
  });

  // ── getVoucherState (read-only) ────────────────────────────────────────────

  it('getVoucherState returns null voucherId for unknown account', async () => {
    voucherSvc.getVoucher.mockResolvedValue(null);
    const state = await service.getVoucherState(ACCOUNT);
    expect(state).toEqual({
      voucherId: null,
      programs: [],
      validUpTo: null,
      varaBalance: '0',
      balanceKnown: true,
      fundedToday: false,
    });
  });

  it('getVoucherState returns fundedToday=false when lastRenewedAt < midnight', async () => {
    voucherSvc.getVoucher.mockResolvedValue(
      makeVoucher({ lastRenewedAt: yesterdayMidnightMinusOneSec() }),
    );
    voucherSvc.getVoucherBalance.mockResolvedValue(1500n);
    const state = await service.getVoucherState(ACCOUNT);
    expect(state.fundedToday).toBe(false);
    expect(state.varaBalance).toBe('1500');
    expect(state.balanceKnown).toBe(true);
  });

  it('getVoucherState returns fundedToday=true when lastRenewedAt >= midnight', async () => {
    voucherSvc.getVoucher.mockResolvedValue(makeVoucher({ lastRenewedAt: new Date() }));
    voucherSvc.getVoucherBalance.mockResolvedValue(1800n);
    const state = await service.getVoucherState(ACCOUNT);
    expect(state.fundedToday).toBe(true);
    expect(state.varaBalance).toBe('1800');
    expect(state.balanceKnown).toBe(true);
  });

  it('getVoucherState reports balanceKnown=false and varaBalance=null on RPC failure', async () => {
    // Regression: previously returned varaBalance: "0" which triggered the
    // starter prompt's drained-voucher STOP rule during transient RPC outages.
    // Codex flagged this in PR review. balanceKnown=false signals "decide
    // from fundedToday alone, don't stop on the balance number."
    voucherSvc.getVoucher.mockResolvedValue(makeVoucher({ lastRenewedAt: new Date() }));
    voucherSvc.getVoucherBalance.mockRejectedValue(new Error('RPC down'));
    const state = await service.getVoucherState(ACCOUNT);
    expect(state.voucherId).toBe('0xvoucher');
    expect(state.varaBalance).toBe(null);
    expect(state.balanceKnown).toBe(false);
    expect(state.fundedToday).toBe(true);
  });

  it('getVoucherState throws 400 for invalid address', async () => {
    await expect(service.getVoucherState('invalid')).rejects.toThrow(BadRequestException);
  });

  // ── Per-IP ceiling race regression ────────────────────────────────────────
  // Codex caught this in PR review: previously assertIpUnderCeiling ran, then
  // an `await` yielded the event loop, THEN recordIpIssuance ran. Two parallel
  // requests from the same IP (different accounts) could both pass the check
  // and both record, pushing the total over the ceiling.
  //
  // The fix: reserveIpCeiling does the check + record in a single synchronous
  // block with no awaits between. This test simulates the race.

  it('per-IP ceiling is race-safe for concurrent same-IP different-account requests', async () => {
    // Seed: IP already at 18000 of 20000 (9 prior issuances × 2000).
    for (let i = 0; i < 9; i++) {
      voucherSvc.getVoucher.mockResolvedValueOnce(null);
      await service.requestVoucher({ account: `seed${i}`, program: PROGRAM }, IP);
    }
    // Now fire TWO concurrent requests from the same IP. Both target fresh
    // accounts. Each would charge 2000 (reaching 20000 exactly), but if they
    // both race past the check they'd charge 22000 total.
    //
    // Make voucherSvc.issue hang briefly so the awaits actually overlap —
    // this simulates real chain latency during concurrent requests.
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

    const req1 = service.requestVoucher({ account: 'racer1', program: PROGRAM }, IP);
    const req2 = service.requestVoucher({ account: 'racer2', program: PROGRAM }, IP);
    // Attach no-op error handlers immediately so Node doesn't flag the racing
    // rejection as unhandled during the setImmediate tick below.
    req1.catch(() => {});
    req2.catch(() => {});

    // Let both requests reach the reservation check before any issue() resolves.
    // By the time we resolve the issues, one request should already have thrown 429.
    await new Promise((r) => setImmediate(r));

    resolveFirst('0xnewvoucher1');
    resolveSecond('0xnewvoucher2');

    // Exactly one should succeed, the other should be rejected by the ceiling.
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
    // Design note: signAndSend timeouts may have landed the tx on-chain. If we
    // refunded the IP reservation on failure, an attacker could force failures
    // (or exploit timeouts) to bypass the ceiling by retrying. Honest users
    // occasionally lose ~dailyCap of budget on transient failures as a tax for
    // closing the attack vector. Codex review caught this in PR #23.
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    voucherSvc.issue.mockRejectedValueOnce(new Error('chain down'));

    await expect(
      service.requestVoucher({ account: 'willfail', program: PROGRAM }, IP),
    ).rejects.toThrow();

    // The failed attempt consumed 2000 of the IP's 20000 daily budget.
    // Now 9 more successful requests (9 × 2000 = 18000) fit exactly: 2000 + 18000 = 20000.
    for (let i = 0; i < 9; i++) {
      voucherSvc.getVoucher.mockResolvedValueOnce(null);
      await expect(
        service.requestVoucher({ account: `post${i}`, program: PROGRAM }, IP),
      ).resolves.toBeDefined();
    }

    // The 10th request (would total 22000) must be rejected.
    voucherSvc.getVoucher.mockResolvedValueOnce(null);
    await expect(
      service.requestVoucher({ account: 'overflow', program: PROGRAM }, IP),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });
});
