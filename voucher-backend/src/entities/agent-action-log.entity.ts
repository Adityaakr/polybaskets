import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AgentActionType = 'register' | 'update';

@Entity({ name: 'agent_action_log' })
@Index('idx_agent_action_lookup', ['ss58', 'action', 'createdAt'])
export class AgentActionLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 64 })
  ss58: string;

  @Column({ type: 'varchar', length: 16 })
  action: AgentActionType;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
