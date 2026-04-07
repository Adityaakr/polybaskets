import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decodeAddress, HexString } from '@gear-js/api';
import {
  GaslessProgram,
  GaslessProgramStatus,
} from '../entities/gasless-program.entity';
import { VoucherService } from './voucher.service';

@Injectable()
export class GaslessService {
  private logger = new Logger(GaslessService.name);

  constructor(
    private readonly voucherService: VoucherService,
    @InjectRepository(GaslessProgram)
    private readonly programRepo: Repository<GaslessProgram>,
  ) {}

  async getVoucherInfo() {
    return {
      address: this.voucherService.account?.address,
      balance: await this.voucherService
        .getAccountBalance()
        .then((r) => r.toString(10)),
    };
  }

  async requestVoucher(body: { account: string; program: string }) {
    this.logger.log(`Voucher request: ${JSON.stringify(body)}`);

    let address: HexString;
    try {
      address = decodeAddress(body.account);
    } catch {
      throw new BadRequestException('Invalid account address');
    }

    const program = await this.programRepo.findOneBy({
      address: body.program,
    });

    if (!program || program.status !== GaslessProgramStatus.Enabled) {
      throw new BadRequestException(
        'Voucher not available for this program. Is it whitelisted?',
      );
    }

    const existing = await this.voucherService.getVoucher(address);

    if (program.oneTime && existing) {
      throw new BadRequestException('One-time voucher already issued');
    }

    const { duration, varaToIssue: amount } = program;

    if (!existing) {
      try {
        const voucherId = await this.voucherService.issue(
          address,
          body.program as HexString,
          amount,
          duration,
        );
        return { voucherId };
      } catch (error) {
        this.logger.error('Failed to issue voucher', error);
        throw new BadRequestException(error.message);
      }
    }

    try {
      if (existing.programs.includes(body.program)) {
        await this.voucherService.update(existing, amount, duration);
      } else {
        await this.voucherService.update(existing, amount, duration, [
          body.program as HexString,
        ]);
      }
      return { voucherId: existing.voucherId };
    } catch (error) {
      this.logger.error('Failed to update voucher', error);
      throw new BadRequestException(error.message);
    }
  }
}
