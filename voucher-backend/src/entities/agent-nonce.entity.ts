import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'agent_nonce' })
export class AgentNonce {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  nonce: string;

  @Index()
  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;
}
