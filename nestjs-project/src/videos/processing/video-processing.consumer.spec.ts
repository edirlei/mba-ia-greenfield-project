import type { ConfigType } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { DataSource, EntityManager } from 'typeorm';
import videoProcessingConfig from '../../config/video-processing.config';
import { VIDEO_PROCESSING_JOB } from '../../queue/queue.constants';
import { Video, VideoStatus } from '../entities/video.entity';
import type { VideoMediaProcessor } from './video-media-processor.service';
import { VideoProcessingConsumer } from './video-processing.consumer';
import type {
  ProcessedVideoMedia,
  VideoProcessingJobPayload,
} from './video-processing.types';

const VIDEO_ID = '1dc1be8d-566d-489f-b887-a88474f61a4a';
const EVENT_ID = '8f9c2ec6-c741-4d03-a5bc-8216a40cb52a';

describe('VideoProcessingConsumer', () => {
  let consumer: VideoProcessingConsumer;
  let currentVideo: Video | null;
  let saved: Video[];
  let processMedia: jest.Mock<Promise<ProcessedVideoMedia>, [Video]>;

  const media: ProcessedVideoMedia = {
    durationSeconds: '1.200',
    thumbnailStorageKey: `videos/${VIDEO_ID}/thumbnails/default.jpg`,
    metadata: {
      formatName: 'mov,mp4',
      formatLongName: 'QuickTime / MOV',
      bitRate: 1000,
      videoCodec: 'h264',
      width: 320,
      height: 240,
      frameRate: 25,
    },
  };
  const config = {
    concurrency: 1,
    attempts: 5,
    backoffMs: 5000,
    tempDir: '/tmp/streamtube-videos',
    outboxPollIntervalMs: 1000,
    outboxBatchSize: 25,
  } as ConfigType<typeof videoProcessingConfig>;

  const video = (status = VideoStatus.PROCESSING): Video =>
    Object.assign(new Video(), {
      id: VIDEO_ID,
      status,
      source_storage_key: `videos/${VIDEO_ID}/source`,
      processing_started_at: null,
      processing_error: null,
      duration_seconds: null,
      metadata: null,
      thumbnail_storage_key: null,
      processed_at: null,
    });

  const job = (
    attemptsMade = 0,
    name = VIDEO_PROCESSING_JOB,
  ): Job<VideoProcessingJobPayload> =>
    ({
      name,
      attemptsMade,
      opts: { attempts: 5 },
      data: {
        schemaVersion: 1,
        eventId: EVENT_ID,
        videoId: VIDEO_ID,
        sourceStorageKey: `videos/${VIDEO_ID}/source`,
        requestedAt: '2026-08-09T12:00:00.000Z',
      },
    }) as Job<VideoProcessingJobPayload>;

  beforeEach(() => {
    currentVideo = video();
    saved = [];
    processMedia = jest.fn<Promise<ProcessedVideoMedia>, [Video]>(() =>
      Promise.resolve(media),
    );
    const manager = {
      findOne: (): Promise<Video | null> => Promise.resolve(currentVideo),
      save: (entity: Video): Promise<Video> => {
        saved.push(entity);
        currentVideo = entity;
        return Promise.resolve(entity);
      },
    };
    const dataSource = {
      transaction: <T>(
        work: (transactionManager: EntityManager) => Promise<T>,
      ): Promise<T> => work(manager as unknown as EntityManager),
    };
    consumer = new VideoProcessingConsumer(
      dataSource as unknown as DataSource,
      { process: processMedia } as unknown as VideoMediaProcessor,
      config,
    );
  });

  it.each([null, VideoStatus.DRAFT, VideoStatus.READY, VideoStatus.ERROR])(
    'treats missing or %s video as a terminal no-op',
    async (status) => {
      currentVideo = status === null ? null : video(status);

      await expect(consumer.process(job())).resolves.toBeUndefined();

      expect(processMedia).not.toHaveBeenCalled();
      expect(saved).toHaveLength(0);
    },
  );

  it('marks processing start and commits normalized READY data', async () => {
    await consumer.process(job());

    expect(processMedia).toHaveBeenCalledTimes(1);
    expect(currentVideo?.processing_started_at).toBeInstanceOf(Date);
    expect(currentVideo?.status).toBe(VideoStatus.READY);
    expect(currentVideo?.duration_seconds).toBe(media.durationSeconds);
    expect(currentVideo?.metadata).toEqual(media.metadata);
    expect(currentVideo?.thumbnail_storage_key).toBe(media.thumbnailStorageKey);
    expect(currentVideo?.processed_at).toBeInstanceOf(Date);
    expect(currentVideo?.processing_error).toBeNull();
  });

  it('rethrows a transient failure without moving the video to ERROR', async () => {
    processMedia.mockRejectedValue(new Error('temporary storage failure'));

    await expect(consumer.process(job(0))).rejects.toThrow(
      'temporary storage failure',
    );

    expect(currentVideo?.status).toBe(VideoStatus.PROCESSING);
    expect(currentVideo?.processing_error).toBeNull();
  });

  it('moves PROCESSING to ERROR only on the fifth failed attempt', async () => {
    processMedia.mockRejectedValue(new Error('ffmpeg failed'));

    await expect(consumer.process(job(4))).rejects.toThrow('ffmpeg failed');

    expect(currentVideo?.status).toBe(VideoStatus.ERROR);
    expect(currentVideo?.processing_error).toBe('ffmpeg failed');
  });

  it('rejects an unsupported job name', async () => {
    await expect(consumer.process(job(0, 'other-job'))).rejects.toThrow(
      'Unsupported video processing job',
    );
    expect(processMedia).not.toHaveBeenCalled();
  });
});
