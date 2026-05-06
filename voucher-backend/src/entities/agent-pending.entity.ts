import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AgentPendingStatus =
  | 'chain_pending'
  | 'ens_pending'
  | 'complete'
  | 'chain_failed';

@Entity({ name: 'agent_pending' })
@Index('idx_agent_pending_status', ['status', 'lastAttemptAt'])
export class AgentPending {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  ss58: string;

  @Column({ type: 'varchar', length: 32 })
  label: string;

  @Column({ type: 'varchar', length: 32 })
  status: AgentPendingStatus;

  @CreateDateColumn({ name: 'requested_at', type: 'datetime' })
  requestedAt: Date;

  @UpdateDateColumn({ name: 'last_attempt_at', type: 'datetime' })
  lastAttemptAt: Date;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
}
