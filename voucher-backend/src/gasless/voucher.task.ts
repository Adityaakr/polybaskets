import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Voucher } from '../entities/voucher.entity';
import { VoucherService } from './voucher.service';

const MAX_PER_ITERATION = 100;

@Injectable()
export class VoucherTask {
  private readonly logger = new Logger(VoucherTask.name);

  constructor(
    @InjectRepository(Voucher)
    private readonly vouchersRepo: Repository<Voucher>,
    private readonly voucherService: VoucherService,
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
        await this.voucherService.revoke(voucher);
        succeeded++;
        this.logger.log(`Revoked voucher ${voucher.voucherId}`);
      } catch (e) {
        this.logger.error(`Failed to revoke ${voucher.voucherId}`, e);
      }
    }

    this.logger.log(`Revoked ${succeeded}/${expired.length} expired vouchers`);
  }
}
