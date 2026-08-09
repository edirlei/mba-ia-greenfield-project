import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('outbox_events')
@Index('IDX_outbox_events_unpublished', ['next_attempt_at', 'created_at'], {
  where: '"published_at" IS NULL',
})
@Index('IDX_outbox_events_aggregate', ['aggregate_type', 'aggregate_id'])
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  aggregate_type: string;

  @Column({ type: 'uuid' })
  aggregate_id: string;

  @Column({ type: 'varchar', length: 100 })
  event_type: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  next_attempt_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
