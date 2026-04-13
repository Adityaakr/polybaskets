import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { GaslessService } from './gasless.service';
import { RequestVoucherDto } from './dto/request-voucher.dto';

// 10 voucher requests per IP per hour
const VOUCHER_THROTTLE = { default: { limit: 10, ttl: 3600000 } };

@Controller()
export class GaslessController {
  constructor(
    private readonly service: GaslessService,
    private readonly configService: ConfigService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'polybaskets-voucher' };
  }

  @Get('info')
  getInfo(@Headers('x-api-key') apiKey: string) {
    const expected = this.configService.get<string>('infoApiKey');
    if (!expected) throw new ForbiddenException();

    // HMAC both sides to fixed-length digests — prevents length oracle
    const hmac = (v: string) => createHmac('sha256', 'polybaskets-info').update(v).digest();
    if (!timingSafeEqual(hmac(apiKey ?? ''), hmac(expected))) {
      throw new ForbiddenException();
    }

    return this.service.getVoucherInfo();
  }

  @Post('voucher')
  @Throttle(VOUCHER_THROTTLE)
  requestVoucher(@Body() body: RequestVoucherDto) {
    return this.service.requestVoucher(body);
  }
}
