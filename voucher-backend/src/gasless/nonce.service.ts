import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AgentNonce } from '../entities/agent-nonce.entity';

@Injectable()
export class NonceService {
  constructor(
    @InjectRepository(AgentNonce)
    private readonly repo: Repository<AgentNonce>,
  ) {}

  async consume(nonce: string, expiresAt: Date): Promise<boolean> {
    try {
      await this.repo.insert({ nonce, expiresAt });
      return true;
    } catch (err: any) {
      // Unique violation = nonce already used
      // Postgres returns code 23505, SQLite returns a message matching /UNIQUE/i
      if (err?.code === '23505' || /UNIQUE/i.test(err?.message ?? '')) {
        return false;
      }
      throw err;
    }
  }

  async pruneExpired(): Promise<number> {
    const result = await this.repo.delete({ expiresAt: LessThan(new Date()) });
    return result.affected ?? 0;
  }
}
