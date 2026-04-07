import { Body, Controller, Get, Post } from '@nestjs/common';
import { GaslessService } from './gasless.service';

@Controller()
export class GaslessController {
  constructor(private readonly service: GaslessService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'polybaskets-voucher' };
  }

  @Get('info')
  getInfo() {
    return this.service.getVoucherInfo();
  }

  @Post('voucher')
  requestVoucher(@Body() body: { account: string; program: string }) {
    return this.service.requestVoucher(body);
  }
}
