import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AgentService, RegisterFailure, UpdateFailure } from './agent.service';
import { RegisterAgentDto } from './dto/register-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

const REGISTER_HTTP: Record<RegisterFailure, number> = {
  expired: 400,
  replay: 400,
  invalid_signature: 401,
  invalid_label: 400,
  name_taken: 409,
  rate_limited: 429,
  audience_mismatch: 400,
  chain_failed: 502,
};

const UPDATE_HTTP: Record<UpdateFailure, number> = {
  expired: 400,
  replay: 400,
  invalid_signature: 401,
  audience_mismatch: 400,
  rate_limited: 429,
  forbidden: 403,
  not_registered: 404,
  invalid_field: 400,
};

@Controller('/api/v1/agents')
export class AgentController {
  constructor(private readonly agents: AgentService) {}

  @Post('/register')
  @HttpCode(200)
  async register(@Body() body: RegisterAgentDto) {
    const result = await this.agents.register(body);
    if (!result.ok) {
      this.throwFor(REGISTER_HTTP[result.reason], result.reason, result.message);
    }
    return { label: (result as any).label };
  }

  @Patch('/profile')
  @HttpCode(200)
  async update(@Body() body: UpdateAgentDto) {
    const result = await this.agents.update(body);
    if (!result.ok) {
      this.throwFor(UPDATE_HTTP[result.reason], result.reason, result.message);
    }
    return { ok: true };
  }

  @Get('/availability/:label')
  availability(@Param('label') label: string) {
    return this.agents.availability(label);
  }

  @Get('/by-label/:label')
  async byLabel(@Param('label') label: string) {
    return (await this.agents.forward(label)) ?? null;
  }

  @Get('/by-address/:ss58')
  async byAddress(@Param('ss58') ss58: string) {
    return (await this.agents.reverse(ss58)) ?? null;
  }

  @Post('/by-addresses')
  @HttpCode(200)
  async byAddresses(@Body() body: { ss58s: string[] }) {
    if (!body || !Array.isArray(body.ss58s)) {
      throw new BadRequestException('ss58s must be an array');
    }
    return this.agents.bulkReverse(body.ss58s);
  }

  private throwFor(status: number, reason: string, message?: string): never {
    const detail = message ? `${reason}: ${message}` : reason;
    if (status === 401) throw new UnauthorizedException(detail);
    if (status === 403) throw new ForbiddenException(detail);
    if (status === 404) throw new NotFoundException(detail);
    if (status === 409) throw new ConflictException(detail);
    if (status === 429)
      throw new HttpException(detail, HttpStatus.TOO_MANY_REQUESTS);
    if (status === 502)
      throw new HttpException(detail, HttpStatus.BAD_GATEWAY);
    throw new BadRequestException(detail);
  }
}
