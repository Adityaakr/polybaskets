import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentPending } from '../entities/agent-pending.entity';
import { MigrationTask } from './migration.task';

describe('MigrationTask', () => {
  let task: MigrationTask;
  let pending: Repository<AgentPending>;
  const mockChain = {
    getAllAgents: jest.fn(),
  };

  beforeEach(async () => {
    mockChain.getAllAgents.mockReset();

    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [AgentPending],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([AgentPending]),
      ],
      providers: [
        MigrationTask,
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => {
              const m: Record<string, any> = {
                'agents.migrationEnabled': true,
              };
              return m[k];
            },
          },
        },
        // Inject ChainSubmitter via the same token as the real impl uses.
        { provide: 'ChainAgentReader', useValue: mockChain },
      ],
    }).compile();

    task = module.get(MigrationTask);
    pending = module.get(getRepositoryToken(AgentPending));
  });

  it('seeds ens_pending rows for each on-chain agent', async () => {
    mockChain.getAllAgents.mockResolvedValueOnce([
      { address: 'kGkAlice', name: 'alice' },
      { address: 'kGkBob', name: 'bob' },
    ]);
    await task.runOnce();
    const rows = await pending.find({ order: { ss58: 'ASC' } });
    expect(rows.map((r) => r.label)).toEqual(['alice', 'bob']);
    expect(rows.every((r) => r.status === 'ens_pending')).toBe(true);
  });

  it('skips agents that already have a pending row', async () => {
    await pending.save({
      ss58: 'kGkAlice',
      label: 'alice',
      status: 'complete',
      attemptCount: 0,
      errorMessage: null,
    });
    mockChain.getAllAgents.mockResolvedValueOnce([
      { address: 'kGkAlice', name: 'alice' },
      { address: 'kGkBob', name: 'bob' },
    ]);
    await task.runOnce();
    const alice = await pending.findOneByOrFail({ ss58: 'kGkAlice' });
    expect(alice.status).toBe('complete'); // unchanged
    const bob = await pending.findOneByOrFail({ ss58: 'kGkBob' });
    expect(bob.status).toBe('ens_pending');
  });

  it('runOnBoot is a no-op when migration disabled', async () => {
    const disabled = (k: string) =>
      k === 'agents.migrationEnabled' ? false : undefined;
    (task as any).config.get = disabled;
    await task.runOnBoot();
    expect(mockChain.getAllAgents).not.toHaveBeenCalled();
  });
});
