import { Injectable, Logger, BadRequestException } from '@nestjs/common';
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

@Injectable()
export class GaslessService {
  private logger = new Logger(GaslessService.name);

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
   * Sum of VARA issued or renewed today (UTC midnight). Uses lastRenewedAt so
   * renewals count toward the cap, not just new issuances.
   */
  private async getTodayIssuedVara(): Promise<number> {
    const todayMidnight = new Date();
    todayMidnight.setUTCHours(0, 0, 0, 0);

    const result = await this.voucherRepo
      .createQueryBuilder('v')
      .select('SUM(v.varaToIssue)', 'total')
      .where('v.lastRenewedAt >= :since', { since: todayMidnight })
      .getRawOne();

    return Number(result?.total ?? 0);
  }

  /**
   * Deterministic integer key for a PostgreSQL advisory lock, keyed on UTC date.
   * Serializes all voucher issuances within a calendar day to prevent TOCTOU
   * races on the daily cap check.
   */
  private getTodayLockKey(): number {
    const dateStr = new Date().toISOString().slice(0, 10); // e.g. '2026-04-07'
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
      hash = (hash * 31 + dateStr.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  async getVoucherInfo() {
    return {
      address: this.voucherService.account?.address,
      balance: await this.voucherService
        .getAccountBalance()
        .then((r) => r.toString(10)),
    };
  }

  async requestVoucher(body: { account: string; program: string }) {
    this.logger.log(`Voucher request for program ${body.program}`);

    let address: HexString;
    try {
      address = decodeAddress(body.account);
    } catch {
      throw new BadRequestException('Invalid account address');
    }

    // Normalize program address to lowercase to avoid case-sensitive mismatch
    const programAddress = body.program.toLowerCase();

    const program = await this.programRepo.findOneBy({
      address: programAddress,
    });

    if (!program || program.status !== GaslessProgramStatus.Enabled) {
      throw new BadRequestException(
        'Voucher not available for this program. Is it whitelisted?',
      );
    }

    const existing = await this.voucherService.getVoucher(address);

    // oneTime check: only block if this specific program is already in the voucher
    if (program.oneTime && existing?.programs.includes(programAddress)) {
      throw new BadRequestException('One-time voucher already issued');
    }

    const { duration, varaToIssue: amount } = program;

    // Advisory lock keyed on UTC date to serialize cap check + issuance.
    // Prevents two concurrent requests from both reading todayTotal < cap and
    // both issuing, which would exceed the daily budget.
    const lockKey = this.getTodayLockKey();
    await this.dataSource.query('SELECT pg_advisory_lock($1)', [lockKey]);

    try {
      const dailyCap = this.configService.get<number>('dailyVaraCap');
      const todayTotal = await this.getTodayIssuedVara();
      if (todayTotal + amount > dailyCap) {
        this.logger.warn(
          `Daily cap reached: ${todayTotal}/${dailyCap} VARA issued today`,
        );
        throw new BadRequestException(
          'Daily voucher budget exhausted. Try again tomorrow.',
        );
      }

      if (!existing) {
        const voucherId = await this.voucherService.issue(
          address,
          programAddress as HexString,
          amount,
          duration,
        );
        return { voucherId };
      }

      if (existing.programs.includes(programAddress)) {
        await this.voucherService.update(existing, amount, duration);
      } else {
        await this.voucherService.update(existing, amount, duration, [
          programAddress as HexString,
        ]);
      }
      return { voucherId: existing.voucherId };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error('Failed to process voucher request', error);
      throw new BadRequestException('Failed to process voucher request');
    } finally {
      await this.dataSource.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    }
  }
}
