import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AgentPending } from '../entities/agent-pending.entity';
import { OffchainManagerClient } from './offchain-manager.client';
import { NonceService } from './nonce.service';

const BATCH_SIZE = 50;

@Injectable()
export class RetryWorker {
  private readonly logger = new Logger(RetryWorker.name);

  constructor(
    @InjectRepository(AgentPending)
    private readonly pending: Repository<AgentPending>,
    private readonly ens: OffchainManagerClient,
    private readonly nonces: NonceService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    const interval =
      this.config.get<number>('agents.retryIntervalMs') ?? 30_000;
    const cutoff = new Date(Date.now() - interval);

    const rows = await this.pending.find({
      where: { status: 'ens_pending', lastAttemptAt: LessThan(cutoff) },
      order: { requestedAt: 'ASC' },
      take: BATCH_SIZE,
    });

    for (const row of rows) {
      try {
        await this.ens.createForAgent({ label: row.label, ss58: row.ss58 });
        await this.pending.update(
          { ss58: row.ss58 },
          { status: 'complete', errorMessage: null },
        );
      } catch (err: any) {
        const message = err?.message ?? 'unknown';
        // Read-then-write to stay compatible with both SQLite (tests) and Postgres (prod)
        const fresh = await this.pending.findOneByOrFail({ ss58: row.ss58 });
        await this.pending.update(
          { ss58: row.ss58 },
          { attemptCount: fresh.attemptCount + 1, errorMessage: message },
        );
        this.logger.warn(`Retry failed for ${row.label}: ${message}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async pruneNonces(): Promise<void> {
    const removed = await this.nonces.pruneExpired();
    if (removed > 0) this.logger.log(`Pruned ${removed} expired nonces`);
  }
}
