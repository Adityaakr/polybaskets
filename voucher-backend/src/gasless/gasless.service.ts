import { Injectable, Logger, BadRequestException, InternalServerErrorException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { decodeAddress, HexString } from '@gear-js/api';
import {
  GaslessProgram,
  GaslessProgramStatus,
} from '../entities/gasless-program.entity';
import { Voucher } from '../entities/voucher.entity';
import { VoucherService } from './voucher.service';
import { ConfigService } from '@nestjs/config';

/**
 * Season 2 (Path B):
 *   - One voucher per account, funded once per UTC day to `dailyVaraCap` VARA.
 *   - First POST of the UTC day: issue or top-up to cap, append program.
 *   - Subsequent same-day POSTs: append program only (no balance change, no cap charge).
 *   - Voucher covers all 3 PolyBaskets programs after 3 POSTs, same voucherId throughout.
 *
 * Abuse gates (additive):
 *   1. Per-IP POST throttle (3/hour) at the controller layer.
 *   2. Per-IP daily VARA ceiling (in-memory Map in this service).
 *   3. TOCTOU-safe per-account advisory lock (pg_advisory_lock).
 */
@Injectable()
export class GaslessService {
  private logger = new Logger(GaslessService.name);

  /**
   * In-memory counter: per-IP VARA issued during the current UTC day.
   * Restart resets the counter (permissive, not restrictive — attacker gains
   * nothing from restarts; honest users regain budget after transient downtime).
   */
  private ipVaraToday = new Map<string, { day: string; varaIssued: number }>();

  constructor(
    private readonly voucherService: VoucherService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(GaslessProgram)
    private readonly programRepo: Repository<GaslessProgram>,
    @InjectRepository(Voucher)
    private readonly voucherRepo: Repository<Voucher>,
  ) {}

  /**
   * Deterministic integer key for a PostgreSQL advisory lock, keyed on agent
   * address + UTC date. Serializes concurrent requests from the same agent to
   * prevent TOCTOU races on the per-account daily-gate check.
   */
  private getTodayLockKey(account: string): number {
    const dateStr = new Date().toISOString().slice(0, 10); // e.g. '2026-04-21'
    const key = `${account}:${dateStr}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  private getTodayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private getTodayMidnight(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Per-IP daily VARA ceiling enforcement. Call before issuing/funding.
   * Throws 429 if the IP would exceed the ceiling.
   */
  private assertIpUnderCeiling(ip: string, additionalVara: number) {
    const ceiling = this.configService.get<number>('perIpDailyVaraCeiling');
    if (!ceiling || ceiling <= 0) return; // disabled

    const today = this.getTodayIsoDate();
    const existing = this.ipVaraToday.get(ip);
    const current = existing && existing.day === today ? existing.varaIssued : 0;

    if (current + additionalVara > ceiling) {
      this.logger.warn(
        `Per-IP ceiling hit for ${ip}: ${current}+${additionalVara} > ${ceiling}`,
      );
      throw new HttpException(
        `Daily VARA ceiling exceeded for this IP. Limit: ${ceiling} VARA/UTC-day.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordIpIssuance(ip: string, vara: number) {
    const today = this.getTodayIsoDate();
    const existing = this.ipVaraToday.get(ip);
    if (existing && existing.day === today) {
      existing.varaIssued += vara;
    } else {
      this.ipVaraToday.set(ip, { day: today, varaIssued: vara });
    }

    // Opportunistic eviction: drop entries for stale days whenever the map grows past a threshold.
    if (this.ipVaraToday.size > 1000) {
      for (const [k, v] of this.ipVaraToday) {
        if (v.day !== today) this.ipVaraToday.delete(k);
      }
    }
  }

  async getVoucherInfo() {
    return {
      address: this.voucherService.account?.address,
      balance: await this.voucherService
        .getAccountBalance()
        .then((r) => r.toString(10)),
    };
  }

  /**
   * Read-only voucher state. No cap charge. Used by agents to decide whether
   * to POST a new voucher request or reuse an existing one this UTC day.
   */
  async getVoucherState(account: string) {
    let address: HexString;
    try {
      address = decodeAddress(account);
    } catch {
      throw new BadRequestException('Invalid account address');
    }

    const voucher = await this.voucherService.getVoucher(address);
    if (!voucher) {
      return {
        voucherId: null,
        programs: [],
        validUpTo: null,
        varaBalance: '0',
        fundedToday: false,
      };
    }

    let balance = 0n;
    try {
      balance = await this.voucherService.getVoucherBalance(voucher.voucherId);
    } catch (e) {
      this.logger.warn(`getVoucherBalance failed for ${voucher.voucherId}: ${e}`);
      // Fall through with 0 — agent can still decide based on DB state.
    }

    return {
      voucherId: voucher.voucherId,
      programs: voucher.programs,
      validUpTo: voucher.validUpTo,
      varaBalance: balance.toString(10),
      fundedToday: voucher.lastRenewedAt >= this.getTodayMidnight(),
    };
  }

  async requestVoucher(body: { account: string; program: string }, ip: string) {
    this.logger.log(`Voucher request for program ${body.program} from ip ${ip}`);

    let address: HexString;
    try {
      address = decodeAddress(body.account);
    } catch {
      throw new BadRequestException('Invalid account address');
    }

    const programAddress = body.program.toLowerCase();

    const program = await this.programRepo.findOneBy({
      address: programAddress,
    });

    if (!program || program.status !== GaslessProgramStatus.Enabled) {
      throw new BadRequestException(
        'Voucher not available for this program. Is it whitelisted?',
      );
    }

    const { duration } = program;
    const dailyCap = this.configService.get<number>('dailyVaraCap');

    // QueryRunner to pin advisory lock/unlock + queries to the same DB connection.
    // pg_advisory_lock is session-scoped, so using DataSource.query() risks
    // acquiring and releasing on different pooled connections.
    const qr = this.dataSource.createQueryRunner();
    let lockAcquired = false;
    // Capture lock key BEFORE any awaited work so we never re-derive it across
    // a UTC midnight boundary in the finally block (previous bug).
    const lockKey = this.getTodayLockKey(address);

    try {
      await qr.connect();
      await qr.query('SELECT pg_advisory_lock($1)', [lockKey]);
      lockAcquired = true;

      // Existing-voucher lookup inside the locked section so two concurrent
      // requests can't both see existing === null and both issue.
      const existing = await this.voucherService.getVoucher(address);

      if (program.oneTime && existing?.programs.includes(programAddress)) {
        throw new BadRequestException('One-time voucher already issued');
      }

      // No existing voucher row — brand new agent. Fund to cap, enforce IP ceiling.
      if (!existing) {
        this.assertIpUnderCeiling(ip, dailyCap);
        const voucherId = await this.voucherService.issue(
          address,
          programAddress as HexString,
          dailyCap,
          duration,
        );
        this.recordIpIssuance(ip, dailyCap);
        return { voucherId };
      }

      const alreadyFundedToday = existing.lastRenewedAt >= this.getTodayMidnight();

      if (!alreadyFundedToday) {
        // First POST of a new UTC day: top voucher back up to cap, append program.
        this.assertIpUnderCeiling(ip, dailyCap);
        const addPrograms = existing.programs.includes(programAddress)
          ? undefined
          : [programAddress as HexString];
        await this.voucherService.update(existing, dailyCap, duration, addPrograms);
        this.recordIpIssuance(ip, dailyCap);
        return { voucherId: existing.voucherId };
      }

      // Already funded today — same voucher, just register an extra program if needed.
      if (!existing.programs.includes(programAddress)) {
        await this.voucherService.appendProgramOnly(
          existing,
          programAddress as HexString,
        );
      }
      return { voucherId: existing.voucherId };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Failed to process voucher request', error);
      throw new InternalServerErrorException('Voucher processing failed — please retry');
    } finally {
      if (lockAcquired) {
        await qr.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      }
      await qr.release();
    }
  }
}
