import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { decodeAddress, HexString } from '@gear-js/api';
import {
  GaslessProgram,
  GaslessProgramStatus,
} from '../entities/gasless-program.entity';
import { Voucher } from '../entities/voucher.entity';
import { VoucherService } from './voucher.service';
import { ConfigService } from '@nestjs/config';

/**
 * Season 2 (hourly-tranche model):
 *   - POST /voucher accepts `programs: string[]` and batch-registers them.
 *   - First POST for an agent issues a voucher with `HOURLY_TRANCHE_VARA` VARA
 *     covering all listed programs.
 *   - Subsequent POSTs ≥ TRANCHE_INTERVAL_SEC after the last funding event add
 *     another `HOURLY_TRANCHE_VARA` AND extend the voucher duration by
 *     `TRANCHE_DURATION_SEC`. New programs in the payload get appended.
 *   - POSTs within TRANCHE_INTERVAL_SEC return 429 with `Retry-After` header.
 *
 * Abuse gates:
 *   1. Per-IP daily tranche ceiling (in-memory Map, permissive on restart).
 *   2. TOCTOU-safe per-account pg_advisory_lock — serializes concurrent
 *      requests from the same wallet so the DB-state check is race-free.
 *   3. DB state is authoritative (survives restarts + multi-pod).
 */
export interface VoucherResult {
  voucherId: string;
}

export interface RateLimitedBody {
  statusCode: 429;
  error: 'Too Many Requests';
  message: string;
  nextEligibleAt: string;
  retryAfterSec: number;
}

export type RequestVoucherResult =
  | { status: 'ok'; voucherId: string }
  | { status: 'rate_limited'; body: RateLimitedBody; retryAfterSec: number };

@Injectable()
export class GaslessService {
  private logger = new Logger(GaslessService.name);

  /**
   * In-memory counter: per-IP tranche count during the current UTC day.
   * Restart resets the counter (permissive, not restrictive — attacker gains
   * nothing from restarts; honest users regain budget after transient downtime).
   */
  private ipTranchesToday = new Map<string, { day: string; trancheCount: number }>();

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
   * Deterministic integer key for a PostgreSQL advisory lock, keyed on the
   * agent address. Serializes concurrent requests from the same agent so the
   * DB-state check (`lastRenewedAt < cutoff`) is race-free. No date suffix —
   * hourly semantics don't need midnight roll-over.
   */
  private getWalletLockKey(account: string): number {
    let hash = 0;
    for (let i = 0; i < account.length; i++) {
      hash = (hash * 31 + account.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  private getTodayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Atomically reserve one tranche from the per-IP daily ceiling.
   *
   * Runs in a single synchronous block — no awaits, no yields — so two
   * concurrent requests from the same IP cannot both see the same remaining
   * budget and both pass.
   *
   * Throws 429 if the IP would exceed the ceiling; otherwise records the
   * reservation and returns. Reservation is NOT refunded on downstream
   * failure (signAndSend timeout may have landed the tx on-chain; refunding
   * would let retries re-mint).
   */
  private reserveIpTrancheCount(ip: string): void {
    const ceiling = this.configService.get<number>('perIpTranchesPerDay');
    if (!ceiling || ceiling <= 0) return; // disabled

    const today = this.getTodayIsoDate();
    const existing = this.ipTranchesToday.get(ip);
    const current = existing && existing.day === today ? existing.trancheCount : 0;

    if (current + 1 > ceiling) {
      this.logger.warn(
        `Per-IP tranche ceiling hit for ${ip}: ${current}+1 > ${ceiling}`,
      );
      throw new HttpException(
        `Daily voucher tranche ceiling exceeded for this IP. Limit: ${ceiling} tranches/UTC-day.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (existing && existing.day === today) {
      existing.trancheCount += 1;
    } else {
      this.ipTranchesToday.set(ip, { day: today, trancheCount: 1 });
    }

    // Opportunistic eviction: drop entries for stale days whenever the map grows past a threshold.
    if (this.ipTranchesToday.size > 1000) {
      for (const [k, v] of this.ipTranchesToday) {
        if (v.day !== today) this.ipTranchesToday.delete(k);
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
   * Read-only voucher state. No ceiling charge. Used by agents to decide
   * whether to POST a new voucher request or wait for the next eligible slot.
   */
  async getVoucherState(account: string) {
    let address: HexString;
    try {
      address = decodeAddress(account);
    } catch {
      throw new BadRequestException('Invalid account address');
    }

    const voucher = await this.voucherService.getVoucher(address);
    const trancheIntervalSec = this.configService.get<number>('trancheIntervalSec');

    if (!voucher) {
      return {
        voucherId: null,
        programs: [],
        validUpTo: null,
        varaBalance: '0',
        balanceKnown: true,
        lastRenewedAt: null,
        nextTopUpEligibleAt: null,
        canTopUpNow: true,
      };
    }

    let balance: bigint | null = null;
    let balanceKnown = true;
    try {
      balance = await this.voucherService.getVoucherBalance(voucher.voucherId);
    } catch (e) {
      // RPC failure — do NOT fabricate a zero balance. Returning "0" would
      // make the starter prompt's drained-voucher STOP rule trigger during
      // a transient Gear node outage, aborting live agents with full vouchers.
      this.logger.warn(`getVoucherBalance failed for ${voucher.voucherId}: ${e}`);
      balanceKnown = false;
    }

    const nextEligibleMs = voucher.lastRenewedAt.getTime() + trancheIntervalSec * 1000;
    const canTopUpNow = Date.now() >= nextEligibleMs;

    return {
      voucherId: voucher.voucherId,
      programs: voucher.programs,
      validUpTo: voucher.validUpTo,
      varaBalance: balance === null ? null : balance.toString(10),
      balanceKnown,
      lastRenewedAt: voucher.lastRenewedAt.toISOString(),
      nextTopUpEligibleAt: new Date(nextEligibleMs).toISOString(),
      canTopUpNow,
    };
  }

  /**
   * Process a voucher request. Returns either `{status: 'ok', voucherId}` on
   * success or `{status: 'rate_limited', body, retryAfterSec}` when the 1h
   * per-wallet limit applies — controller uses retryAfterSec to set the
   * `Retry-After` header.
   */
  async requestVoucher(
    body: { account: string; programs: string[] },
    ip: string,
  ): Promise<RequestVoucherResult> {
    this.logger.log(
      `Voucher request for programs [${body.programs?.join(', ')}] from ip ${ip}`,
    );

    let address: HexString;
    try {
      address = decodeAddress(body.account);
    } catch {
      throw new BadRequestException('Invalid account address');
    }

    // Normalize + dedupe program addresses.
    const programs = Array.from(
      new Set((body.programs ?? []).map((p) => p.toLowerCase())),
    );

    if (programs.length === 0) {
      throw new BadRequestException('programs must be a non-empty array');
    }

    // Batch whitelist lookup. Every requested program must exist + be Enabled.
    const programRows = await this.programRepo.findBy({ address: In(programs) });
    if (programRows.length !== programs.length) {
      const foundAddrs = new Set(programRows.map((r) => r.address));
      const missing = programs.filter((p) => !foundAddrs.has(p));
      throw new BadRequestException(
        `Program(s) not whitelisted: ${missing.join(', ')}`,
      );
    }
    const disabled = programRows.filter(
      (r) => r.status !== GaslessProgramStatus.Enabled,
    );
    if (disabled.length > 0) {
      throw new BadRequestException(
        `Program(s) disabled: ${disabled.map((r) => r.address).join(', ')}`,
      );
    }

    const trancheVara = this.configService.get<number>('hourlyTrancheVara');
    const trancheIntervalSec = this.configService.get<number>('trancheIntervalSec');
    const trancheDurationSec = this.configService.get<number>('trancheDurationSec');

    // QueryRunner to pin advisory lock/unlock to the same DB connection.
    // pg_advisory_lock is session-scoped, so using DataSource.query() risks
    // acquiring and releasing on different pooled connections.
    const qr = this.dataSource.createQueryRunner();
    let lockAcquired = false;
    const lockKey = this.getWalletLockKey(address);

    try {
      await qr.connect();
      await qr.query('SELECT pg_advisory_lock($1)', [lockKey]);
      lockAcquired = true;

      const existing = await this.voucherService.getVoucher(address);

      // oneTime enforcement across the batch: if any requested program is
      // oneTime AND already in the voucher, reject.
      const oneTimeConflicts = programRows
        .filter(
          (r) => r.oneTime && existing?.programs.includes(r.address),
        )
        .map((r) => r.address);
      if (oneTimeConflicts.length > 0) {
        throw new BadRequestException(
          `One-time voucher already issued for: ${oneTimeConflicts.join(', ')}`,
        );
      }

      // Branch (a): no existing voucher → fresh issue.
      if (!existing) {
        this.reserveIpTrancheCount(ip);
        const voucherId = await this.voucherService.issue(
          address,
          programs as HexString[],
          trancheVara,
          trancheDurationSec,
        );
        return { status: 'ok', voucherId };
      }

      const cutoffMs = Date.now() - trancheIntervalSec * 1000;
      const lastRenewedMs = existing.lastRenewedAt.getTime();

      // Branch (b): eligible for top-up.
      if (lastRenewedMs < cutoffMs) {
        const newPrograms = programs.filter(
          (p) => !existing.programs.includes(p),
        );
        this.reserveIpTrancheCount(ip);
        await this.voucherService.update(
          existing,
          trancheVara,
          trancheDurationSec,
          newPrograms.length
            ? (newPrograms as HexString[])
            : undefined,
        );
        return { status: 'ok', voucherId: existing.voucherId };
      }

      // Branch (c): within the 1h window → 429 with Retry-After.
      const nextEligibleMs = lastRenewedMs + trancheIntervalSec * 1000;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((nextEligibleMs - Date.now()) / 1000),
      );
      return {
        status: 'rate_limited',
        retryAfterSec,
        body: {
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Per-wallet rate limit: 1 voucher request per hour',
          nextEligibleAt: new Date(nextEligibleMs).toISOString(),
          retryAfterSec,
        },
      };
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
