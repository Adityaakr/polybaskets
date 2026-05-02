import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentPending } from '../entities/agent-pending.entity';

export interface ChainAgentReader {
  getAllAgents(): Promise<Array<{ address: string; name: string }>>;
}

@Injectable()
export class MigrationTask implements OnModuleInit {
  private readonly logger = new Logger(MigrationTask.name);

  constructor(
    @InjectRepository(AgentPending)
    private readonly pending: Repository<AgentPending>,
    private readonly config: ConfigService,
    @Inject('ChainAgentReader')
    private readonly chain: ChainAgentReader,
  ) {}

  async onModuleInit() {
    await this.runOnBoot();
  }

  async runOnBoot(): Promise<void> {
    if (!this.config.get<boolean>('agents.migrationEnabled')) return;
    this.logger.log('MIGRATION_ENABLED=true — running one-shot bulk migration');
    await this.runOnce();
  }

  async runOnce(): Promise<{ inserted: number; skipped: number }> {
    const agents = await this.chain.getAllAgents();
    let inserted = 0;
    let skipped = 0;
    for (const agent of agents) {
      const existing = await this.pending.findOneBy({ ss58: agent.address });
      if (existing) {
        skipped++;
        continue;
      }
      await this.pending.insert({
        ss58: agent.address,
        label: agent.name,
        status: 'ens_pending',
        attemptCount: 0,
        errorMessage: null,
      });
      inserted++;
    }
    this.logger.log(
      `Migration complete: inserted=${inserted}, skipped=${skipped}, total=${agents.length}`,
    );
    return { inserted, skipped };
  }
}
