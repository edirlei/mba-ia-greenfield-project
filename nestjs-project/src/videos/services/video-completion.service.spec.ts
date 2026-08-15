import type { DataSource, EntityManager } from 'typeorm';
import {
  VideoNotFoundException,
  VideoUploadInvalidPartsException,
  VideoUploadInvalidStateException,
} from '../../common/exceptions/domain.exception';
import type { S3StorageService } from '../../storage/s3-storage.service';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { VIDEO_PROCESSING_EVENT } from '../video.constants';
import { VideoCompletionService } from './video-completion.service';

const USER_ID = '5f813df4-c671-4769-b3db-0f14a89af3a8';
const VIDEO_ID = '0283fae5-587f-4147-ae03-1e5346774316';

describe('VideoCompletionService', () => {
  let service: VideoCompletionService;
  let savedEntities: Array<Video | OutboxEvent>;
  let manager: {
    findOne: jest.Mock<Promise<Video | null>, [typeof Video, object]>;
    save: jest.Mock<Promise<Video | OutboxEvent>, [Video | OutboxEvent]>;
    create: jest.Mock<OutboxEvent, [typeof OutboxEvent, Partial<OutboxEvent>]>;
  };
  let storage: {
    completeMultipartUpload: jest.Mock<
      Promise<{ contentLength: number; eTag: string }>,
      [string, string, Array<{ partNumber: number; eTag: string }>, number]
    >;
  };

  const draftVideo = (): Video =>
    Object.assign(new Video(), {
      id: VIDEO_ID,
      public_id: '1234567890123456789012',
      status: VideoStatus.DRAFT,
      multipart_upload_id: 'upload-id',
      size_bytes: '1024',
      source_storage_key: `videos/${VIDEO_ID}/source`,
      upload_completed_at: null,
    });

  beforeEach(() => {
    savedEntities = [];
    manager = {
      findOne: jest.fn<Promise<Video | null>, [typeof Video, object]>(() =>
        Promise.resolve(draftVideo()),
      ),
      save: jest.fn((entity) => {
        savedEntities.push(entity);
        return Promise.resolve(entity);
      }),
      create: jest.fn((_type, input) =>
        Object.assign(new OutboxEvent(), input),
      ),
    };
    const dataSource = {
      transaction: <T>(
        work: (transactionManager: EntityManager) => Promise<T>,
      ): Promise<T> => work(manager as unknown as EntityManager),
    };
    storage = {
      completeMultipartUpload: jest.fn<
        Promise<{ contentLength: number; eTag: string }>,
        [string, string, Array<{ partNumber: number; eTag: string }>, number]
      >(() => Promise.resolve({ contentLength: 1024, eTag: '"etag"' })),
    };
    service = new VideoCompletionService(
      dataSource as unknown as DataSource,
      storage as unknown as S3StorageService,
    );
  });

  it('hides a video that is not owned by the authenticated user', async () => {
    manager.findOne.mockResolvedValue(null);

    await expect(
      service.completeUpload(USER_ID, VIDEO_ID, {
        uploadId: 'upload-id',
        parts: [{ partNumber: 1, eTag: '"etag"' }],
      }),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });

  it('rejects a mismatched upload identity or invalid state', async () => {
    manager.findOne.mockResolvedValueOnce(draftVideo());
    await expect(
      service.completeUpload(USER_ID, VIDEO_ID, {
        uploadId: 'other-upload',
        parts: [{ partNumber: 1, eTag: '"etag"' }],
      }),
    ).rejects.toBeInstanceOf(VideoUploadInvalidStateException);

    manager.findOne.mockResolvedValueOnce(
      Object.assign(draftVideo(), { status: VideoStatus.ERROR }),
    );
    await expect(
      service.completeUpload(USER_ID, VIDEO_ID, {
        uploadId: 'upload-id',
        parts: [{ partNumber: 1, eTag: '"etag"' }],
      }),
    ).rejects.toBeInstanceOf(VideoUploadInvalidStateException);
  });

  it('rejects incomplete, duplicate or unordered parts before storage', async () => {
    for (const parts of [
      [],
      [
        { partNumber: 1, eTag: '"a"' },
        { partNumber: 1, eTag: '"b"' },
      ],
      [{ partNumber: 2, eTag: '"a"' }],
    ]) {
      manager.findOne.mockResolvedValueOnce(draftVideo());
      await expect(
        service.completeUpload(USER_ID, VIDEO_ID, {
          uploadId: 'upload-id',
          parts,
        }),
      ).rejects.toBeInstanceOf(VideoUploadInvalidPartsException);
    }
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it.each([VideoStatus.PROCESSING, VideoStatus.READY])(
    'returns %s idempotently without touching storage',
    async (status) => {
      manager.findOne.mockResolvedValue(
        Object.assign(draftVideo(), {
          status,
          multipart_upload_id: null,
        }),
      );

      const result = await service.completeUpload(USER_ID, VIDEO_ID, {
        uploadId: 'upload-id',
        parts: [{ partNumber: 1, eTag: '"etag"' }],
      });

      expect(result.status).toBe(status);
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    },
  );

  it('completes storage and persists the transition plus outbox atomically', async () => {
    const result = await service.completeUpload(USER_ID, VIDEO_ID, {
      uploadId: 'upload-id',
      parts: [{ partNumber: 1, eTag: '  "etag"  ' }],
    });

    expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
      `videos/${VIDEO_ID}/source`,
      'upload-id',
      [{ partNumber: 1, eTag: '"etag"' }],
      1024,
    );
    expect(result.status).toBe(VideoStatus.PROCESSING);
    expect(manager.save).toHaveBeenCalledTimes(2);
    const [savedVideo, savedEvent] = savedEntities;
    expect(savedVideo).toBeInstanceOf(Video);
    expect(savedEvent).toBeInstanceOf(OutboxEvent);
    if (
      !(savedVideo instanceof Video) ||
      !(savedEvent instanceof OutboxEvent)
    ) {
      throw new Error('Unexpected entity types persisted by completion');
    }
    expect(savedVideo.multipart_upload_id).toBeNull();
    expect(savedVideo.upload_completed_at).toBeInstanceOf(Date);
    expect(savedEvent.event_type).toBe(VIDEO_PROCESSING_EVENT.EVENT_TYPE);
    expect(savedEvent.aggregate_id).toBe(VIDEO_ID);
    expect(savedEvent.payload).toEqual(
      expect.objectContaining({
        eventId: savedEvent.id,
        videoId: VIDEO_ID,
        sourceStorageKey: `videos/${VIDEO_ID}/source`,
      }),
    );
  });

  it('does not persist partial state when storage completion fails', async () => {
    storage.completeMultipartUpload.mockRejectedValue(new Error('storage'));

    await expect(
      service.completeUpload(USER_ID, VIDEO_ID, {
        uploadId: 'upload-id',
        parts: [{ partNumber: 1, eTag: '"etag"' }],
      }),
    ).rejects.toThrow('storage');
    expect(manager.save).not.toHaveBeenCalled();
  });
});
