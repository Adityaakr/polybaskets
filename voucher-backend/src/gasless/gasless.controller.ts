import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { GaslessService } from './gasless.service';
import { RequestVoucherDto } from './dto/request-voucher.dto';

// POST /voucher — 3 per IP per hour.
// Agents need at most 3 POSTs in a single UTC day (one per program) so the
// first POST of a session has headroom; all subsequent ones for that day are
// cheap appends. An attacker on a single IP caps at ~6,000 VARA/hour drain
// (3 POSTs × 2,000 VARA), further bounded by PER_IP_DAILY_VARA_CEILING.
const VOUCHER_THROTTLE = { default: { limit: 3, ttl: 3600000 } };

// GET /voucher/:account — 20 per IP per minute.
// Read-only state check, no VARA cost. Cheap enough that agents can poll
// mid-session to monitor balance without hitting the limit under honest use.
const VOUCHER_GET_THROTTLE = { default: { limit: 20, ttl: 60000 } };

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
  requestVoucher(@Body() body: RequestVoucherDto, @Ip() ip: string) {
    return this.service.requestVoucher(body, ip);
  }

  @Get('voucher/:account')
  @Throttle(VOUCHER_GET_THROTTLE)
  getVoucherState(@Param('account') account: string) {
    return this.service.getVoucherState(account);
  }
}
