import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getQueueToken } from '@nestjs/bullmq';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { TestingModule, Test } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { DataSource, type Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../../queue/queue.constants';
import { S3StorageService } from '../../storage/s3-storage.service';
import { INTERNAL_S3_CLIENT } from '../../storage/storage.constants';
import {
  cleanAllTables,
  cleanVideoTables,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import type { VideoProcessingJobPayload } from './video-processing.types';
import { VideoWorkerModule } from './video-worker.module';

const execFileAsync = promisify(execFile);

describe('VideoProcessingConsumer full job (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let users: Repository<User>;
  let channels: Repository<Channel>;
  let videos: Repository<Video>;
  let outbox: Repository<OutboxEvent>;
  let queue: Queue<VideoProcessingJobPayload>;
  let storageService: S3StorageService;
  let s3: S3Client;
  let fixtureDir: string;
  let fixture: Buffer;
  const tempRoot = '/tmp/streamtube-consumer-integration';
  const objectKeys = new Set<string>();

  beforeAll(async () => {
    process.env.VIDEO_PROCESSING_TEMP_DIR = tempRoot;
    moduleRef = await Test.createTestingModule({
      imports: [VideoWorkerModule],
    }).compile();
    dataSource = moduleRef.get(DataSource);
    users = dataSource.getRepository(User);
    channels = dataSource.getRepository(Channel);
    videos = dataSource.getRepository(Video);
    outbox = dataSource.getRepository(OutboxEvent);
    queue = moduleRef.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    storageService = moduleRef.get(S3StorageService);
    s3 = moduleRef.get(INTERNAL_S3_CLIENT);

    await queue.obliterate({ force: true });
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    await moduleRef.init();

    fixtureDir = await mkdtemp(join(tmpdir(), 'streamtube-worker-fixture-'));
    const fixturePath = join(fixtureDir, 'fixture.mp4');
    await execFileAsync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=160x120:rate=20',
      '-t',
      '1.1',
      '-c:v',
      'mpeg4',
      '-q:v',
      '5',
      '-pix_fmt',
      'yuv420p',
      '-y',
      fixturePath,
    ]);
    fixture = await readFile(fixturePath);
  });

  beforeEach(async () => {
    await queue.drain(true);
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    await rm(tempRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    for (const key of objectKeys) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.STORAGE_BUCKET ?? 'streamtube',
          Key: key,
        }),
      );
    }
    objectKeys.clear();
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    await rm(tempRoot, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
    await moduleRef.close();
  });

  async function waitFor(
    condition: () => Promise<boolean>,
    timeoutMs = 30_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for video processing');
  }

  async function createProcessingVideo(): Promise<Video> {
    const user = await users.save(
      users.create({
        email: `worker-${randomUUID()}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    const channel = await channels.save(
      channels.create({
        name: 'Worker channel',
        nickname: `worker-${randomUUID()}`.slice(0, 50),
        user_id: user.id,
      }),
    );
    const id = randomUUID();
    const sourceKey = `videos/${id}/source`;
    const item = await videos.save(
      videos.create({
        id,
        channel_id: channel.id,
        public_id: randomUUID().replaceAll('-', '').slice(0, 22),
        title: 'Worker integration video',
        original_filename: 'fixture.mp4',
        content_type: 'video/mp4',
        size_bytes: String(fixture.length),
        status: VideoStatus.PROCESSING,
        source_storage_key: sourceKey,
        thumbnail_storage_key: null,
        multipart_upload_id: null,
        duration_seconds: null,
        metadata: null,
        upload_completed_at: new Date(),
        processing_started_at: null,
        processed_at: null,
        processing_error: null,
      }),
    );
    objectKeys.add(sourceKey);
    objectKeys.add(`videos/${id}/thumbnails/default.jpg`);
    await storageService.putObject(sourceKey, fixture, 'video/mp4');
    return item;
  }

  function payload(video: Video, eventId: string): VideoProcessingJobPayload {
    return {
      schemaVersion: 1,
      eventId,
      videoId: video.id,
      sourceStorageKey: video.source_storage_key,
      requestedAt: new Date().toISOString(),
    };
  }

  it('processes a real job and treats READY redelivery as a no-op', async () => {
    const video = await createProcessingVideo();
    const eventId = randomUUID();
    await queue.add(VIDEO_PROCESSING_JOB, payload(video, eventId), {
      jobId: eventId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 100 },
    });

    await waitFor(async () => {
      const current = await videos.findOneBy({ id: video.id });
      return current?.status === VideoStatus.READY;
    });
    const ready = await videos.findOneByOrFail({ id: video.id });
    expect(ready.processing_started_at).toBeInstanceOf(Date);
    expect(ready.processed_at).toBeInstanceOf(Date);
    expect(ready.duration_seconds).not.toBeNull();
    expect(ready.metadata).toEqual(
      expect.objectContaining({ width: 160, height: 120, videoCodec: 'mpeg4' }),
    );
    expect(ready.thumbnail_storage_key).toBe(
      `videos/${video.id}/thumbnails/default.jpg`,
    );
    const firstThumbnail = await s3.send(
      new HeadObjectCommand({
        Bucket: process.env.STORAGE_BUCKET ?? 'streamtube',
        Key: ready.thumbnail_storage_key!,
      }),
    );
    const firstProcessedAt = ready.processed_at?.getTime();

    const retryId = randomUUID();
    const retry: Job<VideoProcessingJobPayload> = await queue.add(
      VIDEO_PROCESSING_JOB,
      payload(video, retryId),
      { jobId: retryId },
    );
    await waitFor(async () => (await retry.getState()) === 'completed');

    const afterRetry = await videos.findOneByOrFail({ id: video.id });
    const secondThumbnail = await s3.send(
      new HeadObjectCommand({
        Bucket: process.env.STORAGE_BUCKET ?? 'streamtube',
        Key: afterRetry.thumbnail_storage_key!,
      }),
    );
    expect(afterRetry.status).toBe(VideoStatus.READY);
    expect(afterRetry.processed_at?.getTime()).toBe(firstProcessedAt);
    expect(secondThumbnail.ETag).toBe(firstThumbnail.ETag);
    await expect(readdir(tempRoot)).resolves.toHaveLength(0);
    await expect(outbox.count()).resolves.toBe(0);
  });
});
