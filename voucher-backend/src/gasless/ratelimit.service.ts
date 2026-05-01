import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import {
  AgentActionLog,
  AgentActionType,
} from '../entities/agent-action-log.entity';

export type Window = 'lifetime' | 'day';

@Injectable()
export class RateLimitService {
  constructor(
    @InjectRepository(AgentActionLog)
    private readonly repo: Repository<AgentActionLog>,
  ) {}

  async canPerform(
    ss58: string,
    action: AgentActionType,
    window: Window,
    limit = 1,
  ): Promise<boolean> {
    const where: any = { ss58, action };
    if (window === 'day') {
      where.createdAt = MoreThanOrEqual(new Date(Date.now() - 24 * 3600 * 1000));
    }
    const count = await this.repo.count({ where });
    return count < limit;
  }

  async record(ss58: string, action: AgentActionType): Promise<void> {
    await this.repo.insert({ ss58, action });
  }
}
