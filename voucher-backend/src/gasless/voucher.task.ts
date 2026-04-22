import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Voucher } from '../entities/voucher.entity';
import { VoucherService } from './voucher.service';
import { getWalletLockKey } from './wallet-lock';

const MAX_PER_ITERATION = 100;

@Injectable()
export class VoucherTask {
  private readonly logger = new Logger(VoucherTask.name);

  constructor(
    @InjectRepository(Voucher)
    private readonly vouchersRepo: Repository<Voucher>,
    private readonly voucherService: VoucherService,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async revokeExpiredVouchers() {
    this.logger.log('Revoking expired vouchers...');

    const expired = await this.vouchersRepo.find({
      where: { validUpTo: LessThan(new Date()), revoked: false },
      take: MAX_PER_ITERATION,
      order: { validUpTo: 'ASC' },
    });

    let succeeded = 0;
    for (const voucher of expired) {
      try {
        const didRevoke = await this.revokeWithLock(voucher);
        if (didRevoke) {
          succeeded++;
          this.logger.log(`Revoked voucher ${voucher.voucherId}`);
        } else {
          this.logger.log(
            `Skipped revoke for ${voucher.voucherId} — voucher was renewed concurrently`,
          );
        }
      } catch (e) {
        this.logger.error(`Failed to revoke ${voucher.voucherId}`, e);
      }
    }

    this.logger.log(`Revoked ${succeeded}/${expired.length} expired vouchers`);
  }

  /**
   * Revoke under the per-wallet advisory lock. If a concurrent POST /voucher
   * wins the race and renews the voucher (extending validUpTo), the cron
   * must NOT blindly revoke the fresh tranche the user just paid for.
   *
   * Steps:
   *   1. Acquire pg_advisory_lock on the wallet — blocks until the concurrent
   *      request (if any) finishes its update and releases the lock.
   *   2. Re-read the voucher state from DB.
   *   3. If the row still has `revoked=false` AND `validUpTo < now`, revoke.
   *      Otherwise skip — the concurrent request already renewed or revoked it.
   *
   * Returns true when revoke ran, false when skipped.
   */
  private async revokeWithLock(voucher: Voucher): Promise<boolean> {
    const [k1, k2] = getWalletLockKey(voucher.account);
    const qr = this.dataSource.createQueryRunner();
    let lockAcquired = false;
    try {
      await qr.connect();
      await qr.query('SELECT pg_advisory_lock($1, $2)', [k1, k2]);
      lockAcquired = true;

      const fresh = await this.vouchersRepo.findOne({ where: { id: voucher.id } });
      if (!fresh) return false; // row deleted
      if (fresh.revoked) return false; // already revoked by another path
      if (fresh.validUpTo.getTime() >= Date.now()) return false; // renewed mid-cron

      await this.voucherService.revoke(fresh);
      return true;
    } finally {
      if (lockAcquired) {
        await qr.query('SELECT pg_advisory_unlock($1, $2)', [k1, k2]);
      }
      await qr.release();
    }
  }
}
