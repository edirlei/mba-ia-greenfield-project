import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, type Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import queueConfig from '../../config/queue.config';
import videoProcessingConfig from '../../config/video-processing.config';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../../queue/queue.constants';
import { QueueModule } from '../../queue/queue.module';
import {
  cleanAllTables,
  cleanVideoTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { Video } from '../entities/video.entity';
import { VIDEO_PROCESSING_EVENT } from '../video.constants';
import { OutboxPublisherService } from './outbox-publisher.service';
import type { VideoProcessingJobPayload } from './video-processing.types';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  OutboxEvent,
];

describe('OutboxPublisherService (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let repository: Repository<OutboxEvent>;
  let queue: Queue<VideoProcessingJobPayload>;
  let service: OutboxPublisherService;
  let config: ConfigType<typeof videoProcessingConfig>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [queueConfig, videoProcessingConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        TypeOrmModule.forFeature([OutboxEvent]),
        QueueModule,
      ],
      providers: [OutboxPublisherService],
    }).compile();
    dataSource = moduleRef.get(DataSource);
    repository = dataSource.getRepository(OutboxEvent);
    queue = moduleRef.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    service = moduleRef.get(OutboxPublisherService);
    config = moduleRef.get(videoProcessingConfig.KEY);
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    await moduleRef.close();
  });

  async function createEvent(): Promise<OutboxEvent> {
    const eventId = randomUUID();
    const videoId = randomUUID();
    return repository.save(
      repository.create({
        id: eventId,
        aggregate_type: VIDEO_PROCESSING_EVENT.AGGREGATE_TYPE,
        aggregate_id: videoId,
        event_type: VIDEO_PROCESSING_EVENT.EVENT_TYPE,
        payload: {
          schemaVersion: 1,
          eventId,
          videoId,
          sourceStorageKey: `videos/${videoId}/source`,
          requestedAt: new Date().toISOString(),
        },
      }),
    );
  }

  it('publishes a PostgreSQL outbox row to real BullMQ exactly once', async () => {
    const event = await createEvent();

    await expect(service.publishBatch()).resolves.toBe(1);
    await expect(service.publishBatch()).resolves.toBe(0);

    const job = await queue.getJob(event.id);
    expect(job).not.toBeUndefined();
    expect(job?.name).toBe(VIDEO_PROCESSING_JOB);
    expect(job?.data).toEqual(
      expect.objectContaining({
        eventId: event.id,
        videoId: event.aggregate_id,
      }),
    );
    expect(job?.opts.attempts).toBe(config.attempts);
    const persisted = await repository.findOneByOrFail({ id: event.id });
    expect(persisted.published_at).toBeInstanceOf(Date);
    expect(persisted.attempts).toBe(0);
  });

  it('keeps the row pending while Redis is unavailable and publishes after recovery', async () => {
    const event = await createEvent();
    const unavailableQueue = new Queue<VideoProcessingJobPayload>(
      `${VIDEO_PROCESSING_QUEUE}-unavailable`,
      {
        connection: {
          host: '127.0.0.1',
          port: 1,
          connectTimeout: 100,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: () => null,
        },
      },
    );
    const unavailableService = new OutboxPublisherService(
      dataSource,
      unavailableQueue,
      config,
    );

    await expect(unavailableService.publishBatch()).resolves.toBe(0);
    await unavailableQueue.close();
    const pending = await repository.findOneByOrFail({ id: event.id });
    expect(pending.published_at).toBeNull();
    expect(pending.attempts).toBe(1);
    expect(pending.last_error).toBeTruthy();
    pending.next_attempt_at = new Date(0);
    await repository.save(pending);

    await expect(service.publishBatch()).resolves.toBe(1);
    expect(await queue.getJob(event.id)).toBeDefined();
  });

  it('uses row locks to serialize concurrent publishers', async () => {
    const event = await createEvent();

    const results = await Promise.all([
      service.publishBatch(),
      service.publishBatch(),
    ]);

    expect(results.reduce((total, count) => total + count, 0)).toBe(1);
    expect(await queue.getJob(event.id)).toBeDefined();
    const persisted = await repository.findOneByOrFail({ id: event.id });
    expect(persisted.published_at).toBeInstanceOf(Date);
  });
});
