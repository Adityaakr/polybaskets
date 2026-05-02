import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentPending } from '../entities/agent-pending.entity';
import { AgentNonce } from '../entities/agent-nonce.entity';
import { OffchainManagerClient } from './offchain-manager.client';
import { NonceService } from './nonce.service';
import { RetryWorker } from './retry-worker.task';

describe('RetryWorker.tick', () => {
  let worker: RetryWorker;
  let pending: Repository<AgentPending>;
  let ens: jest.Mocked<OffchainManagerClient>;

  beforeEach(async () => {
    ens = { createForAgent: jest.fn() } as any;
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [AgentPending, AgentNonce],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([AgentPending, AgentNonce]),
      ],
      providers: [
        RetryWorker,
        NonceService,
        { provide: OffchainManagerClient, useValue: ens },
        {
          provide: ConfigService,
          useValue: { get: () => 0 }, // retryIntervalMs=0 so the cutoff allows immediate pickup
        },
      ],
    }).compile();
    worker = module.get(RetryWorker);
    pending = module.get(getRepositoryToken(AgentPending));
  });

  it('reconciles ens_pending rows: success marks complete, failure increments attempt_count', async () => {
    await pending.save([
      {
        ss58: 'ss58-ok',
        label: 'okuser',
        status: 'ens_pending' as const,
        attemptCount: 0,
        errorMessage: null,
      },
      {
        ss58: 'ss58-bad',
        label: 'baduser',
        status: 'ens_pending' as const,
        attemptCount: 0,
        errorMessage: null,
      },
    ]);

    ens.createForAgent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('still flaky'));

    await worker.tick();

    const ok = await pending.findOneByOrFail({ ss58: 'ss58-ok' });
    const bad = await pending.findOneByOrFail({ ss58: 'ss58-bad' });
    expect(ok.status).toBe('complete');
    expect(ok.errorMessage).toBeNull();
    expect(bad.status).toBe('ens_pending');
    expect(bad.attemptCount).toBeGreaterThanOrEqual(1);
    expect(bad.errorMessage).toContain('still flaky');
  });
});
