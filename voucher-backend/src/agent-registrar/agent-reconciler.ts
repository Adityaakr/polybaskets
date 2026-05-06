import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OffchainManagerClient } from './offchain-manager.client';
import { VaraAgentReader, AgentInfo } from './vara-agent.reader';

export type ReconcileSummary = {
  total: number;
  created: number;
  skipped: number;
  failed: number;
};

@Injectable()
export class AgentReconciler implements OnModuleInit {
  private logger = new Logger(AgentReconciler.name);
  private attempts = new Map<string, number>();
  private maxAttempts: number;

  constructor(
    private readonly reader: VaraAgentReader,
    private readonly client: OffchainManagerClient,
    private readonly configService: ConfigService,
  ) {
    const configuredMax = this.configService.get<number>('agentRegistrar.retryMaxAttempts');
    this.maxAttempts = typeof configuredMax === 'number' ? configuredMax : 288;
  }

  async onModuleInit(): Promise<void> {
    await this.runMigration();
  }

  async runMigration(): Promise<void> {
    const enabled = this.configService.get<boolean>(
      'agentRegistrar.migrationEnabled',
    );
    if (!enabled) return;
    const agents = await this.reader.getAllAgents();
    const summary = await this.reconcileAgents(agents);
    this.logger.log(
      `migration complete: total=${summary.total} created=${summary.created} skipped=${summary.skipped} failed=${summary.failed}`,
    );
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async reconcileTick(): Promise<void> {
    try {
      const agents = await this.reader.getAllAgents();
      await this.reconcileAgents(agents);
    } catch (e) {
      this.logger.warn(`reconcile tick failed: ${(e as Error).message}`);
    }
  }

  async reconcileAgents(agents: AgentInfo[]): Promise<ReconcileSummary> {
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const agent of agents) {
      const attempts = (this.attempts.get(agent.address) ?? 0) + 1;
      if (attempts > this.maxAttempts) {
        skipped++;
        continue;
      }

      try {
        const existing = await this.client.findByVaraAddress(agent.address);
        if (existing && existing.label === agent.name) {
          skipped++;
          this.attempts.delete(agent.address);
          continue;
        }
        if (existing && existing.label !== agent.name) {
          // Stale subname (agent renamed on-chain). Don't auto-rewrite from
          // the cron — the agent is expected to call POST /agent/register
          // again. Skip + move on.
          skipped++;
          continue;
        }

        const fullName = `${agent.name}.${this.client.parentName}`;
        const available = await this.client.isAvailable(fullName);
        if (!available) {
          this.logger.warn(
            `cannot reconcile ${agent.address}: subname ${fullName} is taken`,
          );
          skipped++;
          continue;
        }

        await this.client.create({
          label: agent.name,
          texts: { name: agent.name },
          addresses: [{ chain: 'Ethereum', value: this.client.ownerEvm }],
          varaAddress: agent.address,
        });
        created++;
        this.attempts.delete(agent.address);
      } catch (e) {
        this.logger.warn(
          `reconcile failed for ${agent.address}: ${(e as Error).message}`,
        );
        this.attempts.set(agent.address, attempts);
        failed++;
      }
    }

    return { total: agents.length, created, skipped, failed };
  }
}
