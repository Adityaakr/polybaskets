import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentActionLog } from '../entities/agent-action-log.entity';
import { RateLimitService } from './ratelimit.service';

describe('RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [AgentActionLog],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([AgentActionLog]),
      ],
      providers: [RateLimitService],
    }).compile();
    service = module.get(RateLimitService);
  });

  it('allows one register per ss58 (lifetime)', async () => {
    expect(await service.canPerform('ss58-1', 'register', 'lifetime')).toBe(true);
    await service.record('ss58-1', 'register');
    expect(await service.canPerform('ss58-1', 'register', 'lifetime')).toBe(
      false,
    );
  });

  it('allows up to 10 updates per day per ss58', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await service.canPerform('ss58-2', 'update', 'day', 10)).toBe(true);
      await service.record('ss58-2', 'update');
    }
    expect(await service.canPerform('ss58-2', 'update', 'day', 10)).toBe(false);
  });
});
