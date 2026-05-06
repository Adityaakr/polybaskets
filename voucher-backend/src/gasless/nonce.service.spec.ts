import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentNonce } from '../entities/agent-nonce.entity';
import { NonceService } from './nonce.service';

describe('NonceService', () => {
  let service: NonceService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [AgentNonce],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([AgentNonce]),
      ],
      providers: [NonceService],
    }).compile();
    service = module.get(NonceService);
  });

  it('accepts a fresh nonce once', async () => {
    const ok = await service.consume('nonce-1', new Date(Date.now() + 60_000));
    expect(ok).toBe(true);
  });

  it('rejects a replayed nonce', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    expect(await service.consume('nonce-2', expiresAt)).toBe(true);
    expect(await service.consume('nonce-2', expiresAt)).toBe(false);
  });

  it('prunes expired nonces', async () => {
    await service.consume('expired', new Date(Date.now() - 1_000));
    await service.consume('valid', new Date(Date.now() + 60_000));
    const removed = await service.pruneExpired();
    expect(removed).toBeGreaterThanOrEqual(1);
    // valid nonce still rejects on replay
    expect(await service.consume('valid', new Date(Date.now() + 60_000))).toBe(
      false,
    );
  });
});
