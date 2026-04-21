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

// POST /voucher — 6 per IP per hour.
// Agents need exactly 3 POSTs in a single UTC day (one per program). The
// throttle counts both failed and successful attempts, so tight limits at 3
// would turn a single transient 5xx into an hour-long outage. 6 leaves
// retry headroom while the per-IP daily VARA ceiling
// (PER_IP_DAILY_VARA_CEILING, default 20,000) still bounds total abuse —
// no matter how many POSTs, once the IP hits the daily VARA budget it's
// rejected at the service layer.
const VOUCHER_THROTTLE = { default: { limit: 6, ttl: 3600000 } };

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
