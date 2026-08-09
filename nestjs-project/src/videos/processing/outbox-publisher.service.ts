import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { DataSource, type EntityManager } from 'typeorm';
import videoProcessingConfig from '../../config/video-processing.config';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_JOB_HISTORY,
  VIDEO_PROCESSING_QUEUE,
} from '../../queue/queue.constants';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { VIDEO_PROCESSING_EVENT } from '../video.constants';
import type { VideoProcessingJobPayload } from './video-processing.types';

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private timer: NodeJS.Timeout | undefined;
  private publishing = false;

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<VideoProcessingJobPayload>,
    @Inject(videoProcessingConfig.KEY)
    private readonly config: ConfigType<typeof videoProcessingConfig>,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.poll();
    }, this.config.outboxPollIntervalMs);
    this.timer.unref();
    void this.poll();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async publishBatch(): Promise<number> {
    return this.dataSource.transaction((manager) =>
      this.publishLockedBatch(manager),
    );
  }

  private async poll(): Promise<void> {
    if (this.publishing) return;
    this.publishing = true;
    try {
      await this.publishBatch();
    } catch (error) {
      this.logger.error('Outbox polling failed', this.errorMessage(error));
    } finally {
      this.publishing = false;
    }
  }

  private async publishLockedBatch(manager: EntityManager): Promise<number> {
    const events = await manager
      .getRepository(OutboxEvent)
      .createQueryBuilder('event')
      .where('event.published_at IS NULL')
      .andWhere('event.next_attempt_at <= :now', { now: new Date() })
      .andWhere('event.event_type = :eventType', {
        eventType: VIDEO_PROCESSING_EVENT.EVENT_TYPE,
      })
      .orderBy('event.created_at', 'ASC')
      .take(this.config.outboxBatchSize)
      .setLock('pessimistic_write', undefined, ['event'])
      .setOnLocked('skip_locked')
      .getMany();

    let published = 0;
    for (const event of events) {
      try {
        const payload = this.toJobPayload(event);
        await this.queue.add(VIDEO_PROCESSING_JOB, payload, {
          jobId: event.id,
          attempts: this.config.attempts,
          backoff: {
            type: 'exponential',
            delay: this.config.backoffMs,
          },
          removeOnComplete: {
            count: VIDEO_PROCESSING_JOB_HISTORY.COMPLETED,
          },
          removeOnFail: { count: VIDEO_PROCESSING_JOB_HISTORY.FAILED },
        });
        event.published_at = new Date();
        event.last_error = null;
        await manager.save(event);
        published++;
      } catch (error) {
        event.attempts += 1;
        event.last_error = this.errorMessage(error).slice(0, 4000);
        event.next_attempt_at = new Date(
          Date.now() + this.publicationBackoff(event.attempts),
        );
        await manager.save(event);
      }
    }
    return published;
  }

  private toJobPayload(event: OutboxEvent): VideoProcessingJobPayload {
    const payload = event.payload;
    if (
      payload.schemaVersion !== VIDEO_PROCESSING_EVENT.SCHEMA_VERSION ||
      typeof payload.eventId !== 'string' ||
      typeof payload.videoId !== 'string' ||
      typeof payload.sourceStorageKey !== 'string' ||
      typeof payload.requestedAt !== 'string'
    ) {
      throw new Error(`Invalid processing payload for outbox ${event.id}`);
    }
    return {
      schemaVersion: VIDEO_PROCESSING_EVENT.SCHEMA_VERSION,
      eventId: payload.eventId,
      videoId: payload.videoId,
      sourceStorageKey: payload.sourceStorageKey,
      requestedAt: payload.requestedAt,
    };
  }

  private publicationBackoff(attempts: number): number {
    return this.config.backoffMs * 2 ** Math.min(Math.max(attempts - 1, 0), 10);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
