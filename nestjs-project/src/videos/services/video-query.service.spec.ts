import type { Repository } from 'typeorm';
import { VideoNotFoundException } from '../../common/exceptions/domain.exception';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideoQueryService } from './video-query.service';

const USER_ID = '5f813df4-c671-4769-b3db-0f14a89af3a8';
const PUBLIC_ID = 'AbCdEfGhIjKlMnOpQrStUv';

describe('VideoQueryService', () => {
  let service: VideoQueryService;
  let findOne: jest.Mock<Promise<Video | null>, [object]>;

  const video = (): Video =>
    Object.assign(new Video(), {
      id: '0283fae5-587f-4147-ae03-1e5346774316',
      public_id: PUBLIC_ID,
      title: 'Safe details',
      original_filename: 'source.mp4',
      content_type: 'video/mp4',
      size_bytes: '10737418240',
      status: VideoStatus.READY,
      duration_seconds: '12.345',
      metadata: {
        formatName: 'mov,mp4',
        formatLongName: 'QuickTime / MOV',
        bitRate: 1000,
        videoCodec: 'h264',
        width: 1920,
        height: 1080,
        frameRate: 30,
      },
      thumbnail_storage_key:
        'videos/0283fae5-587f-4147-ae03-1e5346774316/thumbnails/default.jpg',
      source_storage_key: 'videos/0283fae5-587f-4147-ae03-1e5346774316/source',
      multipart_upload_id: null,
      processing_error: 'must stay internal',
      created_at: new Date('2026-08-09T12:00:00.000Z'),
      updated_at: new Date('2026-08-09T12:01:00.000Z'),
    });

  beforeEach(() => {
    findOne = jest.fn<Promise<Video | null>, [object]>(() =>
      Promise.resolve(video()),
    );
    service = new VideoQueryService({
      findOne,
    } as unknown as Repository<Video>);
  });

  it('maps bigint, numeric and metadata to the safe public response', async () => {
    const result = await service.getDetails(USER_ID, PUBLIC_ID);

    expect(result).toEqual({
      id: '0283fae5-587f-4147-ae03-1e5346774316',
      publicId: PUBLIC_ID,
      title: 'Safe details',
      originalFilename: 'source.mp4',
      contentType: 'video/mp4',
      sizeBytes: 10_737_418_240,
      status: VideoStatus.READY,
      durationSeconds: 12.345,
      metadata: video().metadata,
      thumbnailAvailable: true,
      createdAt: '2026-08-09T12:00:00.000Z',
      updatedAt: '2026-08-09T12:01:00.000Z',
    });
    expect(result).not.toHaveProperty('sourceStorageKey');
    expect(result).not.toHaveProperty('thumbnailStorageKey');
    expect(result).not.toHaveProperty('multipartUploadId');
    expect(result).not.toHaveProperty('processingError');
    expect(findOne).toHaveBeenCalledWith({
      where: { public_id: PUBLIC_ID, channel: { user_id: USER_ID } },
    });
  });

  it('maps nullable processing fields without leaking TypeORM strings', async () => {
    findOne.mockResolvedValue(
      Object.assign(video(), {
        status: VideoStatus.PROCESSING,
        duration_seconds: null,
        metadata: null,
        thumbnail_storage_key: null,
      }),
    );

    const result = await service.getDetails(USER_ID, PUBLIC_ID);

    expect(result.durationSeconds).toBeNull();
    expect(result.metadata).toBeNull();
    expect(result.thumbnailAvailable).toBe(false);
  });

  it('returns the uniform not-found error for missing or foreign videos', async () => {
    findOne.mockResolvedValue(null);

    await expect(service.getDetails(USER_ID, PUBLIC_ID)).rejects.toBeInstanceOf(
      VideoNotFoundException,
    );
  });
});
