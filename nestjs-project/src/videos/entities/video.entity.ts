import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  DRAFT = 'DRAFT',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  ERROR = 'ERROR',
}

export interface VideoMetadata {
  formatName: string;
  formatLongName: string;
  bitRate: number;
  videoCodec: string;
  width: number;
  height: number;
  frameRate: number;
}

@Entity('videos')
@Index('IDX_videos_channel_id', ['channel_id'])
@Index('IDX_videos_status', ['status'])
@Index('IDX_videos_channel_created_at', ['channel_id', 'created_at'])
@Index('UQ_videos_thumbnail_storage_key', ['thumbnail_storage_key'], {
  unique: true,
  where: '"thumbnail_storage_key" IS NOT NULL',
})
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({ type: 'varchar', length: 22, unique: true })
  public_id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 255 })
  original_filename: string;

  @Column({ type: 'varchar', length: 127 })
  content_type: string;

  @Column({ type: 'bigint' })
  size_bytes: string;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    enumName: 'video_status',
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 512, unique: true })
  source_storage_key: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnail_storage_key: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  multipart_upload_id: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 3, nullable: true })
  duration_seconds: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: VideoMetadata | null;

  @Column({ type: 'timestamptz', nullable: true })
  upload_completed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  processing_started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  processed_at: Date | null;

  @Column({ type: 'text', nullable: true })
  processing_error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
