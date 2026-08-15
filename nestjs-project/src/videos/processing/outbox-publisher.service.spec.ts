import type { ConfigType } from '@nestjs/config';
import type { JobsOptions, Queue } from 'bullmq';
import type { DataSource, EntityManager } from 'typeorm';
import videoProcessingConfig from '../../config/video-processing.config';
import { VIDEO_PROCESSING_JOB } from '../../queue/queue.constants';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { VIDEO_PROCESSING_EVENT } from '../video.constants';
import { OutboxPublisherService } from './outbox-publisher.service';
import type { VideoProcessingJobPayload } from './video-processing.types';

const EVENT_ID = '8f9c2ec6-c741-4d03-a5bc-8216a40cb52a';
const VIDEO_ID = '1dc1be8d-566d-489f-b887-a88474f61a4a';

class QueryBuilderStub {
  constructor(private readonly events: OutboxEvent[]) {}
  where(): this {
    return this;
  }
  andWhere(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  take(): this {
    return this;
  }
  setLock(): this {
    return this;
  }
  setOnLocked(): this {
    return this;
  }
  getMany(): Promise<OutboxEvent[]> {
    return Promise.resolve(this.events);
  }
}

describe('OutboxPublisherService', () => {
  let service: OutboxPublisherService;
  let events: OutboxEvent[];
  let saved: OutboxEvent[];
  let addJob: jest.Mock<
    Promise<void>,
    [string, VideoProcessingJobPayload, JobsOptions]
  >;

  const config = {
    concurrency: 1,
    attempts: 5,
    backoffMs: 5000,
    tempDir: '/tmp/streamtube-videos',
    outboxPollIntervalMs: 60_000,
    outboxBatchSize: 25,
  } as ConfigType<typeof videoProcessingConfig>;

  const event = (id = EVENT_ID): OutboxEvent =>
    Object.assign(new OutboxEvent(), {
      id,
      aggregate_type: VIDEO_PROCESSING_EVENT.AGGREGATE_TYPE,
      aggregate_id: VIDEO_ID,
      event_type: VIDEO_PROCESSING_EVENT.EVENT_TYPE,
      payload: {
        schemaVersion: 1,
        eventId: id,
        videoId: VIDEO_ID,
        sourceStorageKey: `videos/${VIDEO_ID}/source`,
        requestedAt: '2026-08-09T12:00:00.000Z',
      },
      attempts: 0,
      next_attempt_at: new Date('2026-08-09T12:00:00.000Z'),
      published_at: null,
      last_error: null,
      created_at: new Date('2026-08-09T12:00:00.000Z'),
    });

  beforeEach(() => {
    events = [event()];
    saved = [];
    addJob = jest.fn<
      Promise<void>,
      [string, VideoProcessingJobPayload, JobsOptions]
    >(() => Promise.resolve());
    const queryBuilder = new QueryBuilderStub(events);
    const manager = {
      getRepository: () => ({ createQueryBuilder: () => queryBuilder }),
      save: (outbox: OutboxEvent): Promise<OutboxEvent> => {
        saved.push(outbox);
        return Promise.resolve(outbox);
      },
    };
    const dataSource = {
      transaction: <T>(
        work: (transactionManager: EntityManager) => Promise<T>,
      ): Promise<T> => work(manager as unknown as EntityManager),
    };
    service = new OutboxPublisherService(
      dataSource as unknown as DataSource,
      { add: addJob } as unknown as Queue<VideoProcessingJobPayload>,
      config,
    );
  });

  it('publishes a locked batch with stable identity and retry options', async () => {
    events.push(event('cd51a955-fb4c-42c7-9bea-62ba33d2953d'));

    await expect(service.publishBatch()).resolves.toBe(2);

    expect(addJob).toHaveBeenCalledTimes(2);
    expect(addJob).toHaveBeenNthCalledWith(
      1,
      VIDEO_PROCESSING_JOB,
      expect.objectContaining({ eventId: EVENT_ID, videoId: VIDEO_ID }),
      expect.objectContaining({
        jobId: EVENT_ID,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
    expect(saved).toHaveLength(2);
    expect(events.every((item) => item.published_at instanceof Date)).toBe(
      true,
    );
  });

  it('keeps a failed event unpublished and schedules exponential retry', async () => {
    addJob.mockRejectedValueOnce(new Error('redis unavailable'));
    const before = Date.now();

    await expect(service.publishBatch()).resolves.toBe(0);

    expect(events[0].published_at).toBeNull();
    expect(events[0].attempts).toBe(1);
    expect(events[0].last_error).toBe('redis unavailable');
    expect(events[0].next_attempt_at.getTime()).toBeGreaterThanOrEqual(
      before + 5000,
    );
  });

  it('isolates malformed payloads without sending a queue job', async () => {
    events[0].payload = { schemaVersion: 1, eventId: EVENT_ID };

    await expect(service.publishBatch()).resolves.toBe(0);

    expect(addJob).not.toHaveBeenCalled();
    expect(events[0].attempts).toBe(1);
    expect(events[0].last_error).toContain('Invalid processing payload');
  });
});
