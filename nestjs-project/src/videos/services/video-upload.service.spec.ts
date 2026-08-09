import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Channel } from '../../channels/entities/channel.entity';
import {
  VideoNotFoundException,
  VideoUploadInvalidPartsException,
  VideoUploadInvalidStateException,
  VideoUploadTooLargeException,
} from '../../common/exceptions/domain.exception';
import { S3StorageService } from '../../storage/s3-storage.service';
import { Video, VideoStatus } from '../entities/video.entity';
import { VIDEO_UPLOAD } from '../video.constants';
import { VideoUploadService } from './video-upload.service';

const USER_ID = '5f813df4-c671-4769-b3db-0f14a89af3a8';
const CHANNEL_ID = '40e0564a-658c-4d95-9558-6f6f82529478';
const VIDEO_ID = '0283fae5-587f-4147-ae03-1e5346774316';

const validDto = {
  title: 'Video title',
  originalFilename: 'video.mp4',
  contentType: 'video/mp4',
  sizeBytes: VIDEO_UPLOAD.MAX_SIZE_BYTES,
};

describe('VideoUploadService', () => {
  let service: VideoUploadService;
  let videoRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };
  let channelRepository: { findOne: jest.Mock };
  let storageService: {
    createMultipartUpload: jest.Mock;
    abortMultipartUpload: jest.Mock;
    signUploadParts: jest.Mock;
    getUploadUrlTtlSeconds: jest.Mock;
  };

  beforeEach(async () => {
    videoRepository = {
      create: jest.fn((input) => Object.assign(new Video(), input)),
      save: jest.fn(async (video) => video as Video),
      findOne: jest.fn(),
    };
    channelRepository = {
      findOne: jest.fn().mockResolvedValue({ id: CHANNEL_ID }),
    };
    storageService = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-id'),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      signUploadParts: jest.fn().mockResolvedValue({
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        parts: [{ partNumber: 1, url: 'http://localhost:9000/signed' }],
      }),
      getUploadUrlTtlSeconds: jest.fn().mockReturnValue(900),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoUploadService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: getRepositoryToken(Channel), useValue: channelRepository },
        { provide: S3StorageService, useValue: storageService },
      ],
    }).compile();
    service = moduleRef.get(VideoUploadService);
  });

  it('rejects declared files larger than 10 GB before touching storage', async () => {
    await expect(
      service.createUpload(USER_ID, {
        ...validDto,
        sizeBytes: VIDEO_UPLOAD.MAX_SIZE_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(VideoUploadTooLargeException);

    expect(channelRepository.findOne).not.toHaveBeenCalled();
    expect(storageService.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('creates a DRAFT upload with 64 MiB parts and a Base64URL public ID', async () => {
    const result = await service.createUpload(USER_ID, validDto);
    const saved = videoRepository.save.mock.calls[0][0];

    expect(result.status).toBe(VideoStatus.DRAFT);
    expect(result.partSizeBytes).toBe(67_108_864);
    expect(result.totalParts).toBe(160);
    expect(result.publicId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(saved.source_storage_key).toBe(`videos/${result.id}/source`);
    expect(saved.size_bytes).toBe(String(VIDEO_UPLOAD.MAX_SIZE_BYTES));
  });

  it('retries a PostgreSQL public_id collision without creating another multipart upload', async () => {
    const publicIds: string[] = [];
    const collision = Object.assign(new Error('duplicate'), {
      code: '23505',
      detail: 'Key (public_id)=(duplicate) already exists.',
    });
    videoRepository.save
      .mockImplementationOnce(async (video) => {
        publicIds.push(video.public_id);
        throw collision;
      })
      .mockImplementationOnce(async (video) => {
        publicIds.push(video.public_id);
        return video;
      });

    await service.createUpload(USER_ID, validDto);

    expect(videoRepository.save).toHaveBeenCalledTimes(2);
    expect(publicIds[0]).not.toBe(publicIds[1]);
    expect(storageService.createMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('aborts multipart storage after exhausting public ID collision retries', async () => {
    const collision = Object.assign(new Error('duplicate'), {
      code: '23505',
      detail: 'Key (public_id)=(duplicate) already exists.',
    });
    videoRepository.save.mockRejectedValue(collision);

    await expect(service.createUpload(USER_ID, validDto)).rejects.toBe(
      collision,
    );

    expect(videoRepository.save).toHaveBeenCalledTimes(5);
    expect(storageService.abortMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('hides uploads that belong to another channel', async () => {
    videoRepository.findOne.mockResolvedValue(null);

    await expect(
      service.signUploadParts(USER_ID, VIDEO_ID, {
        uploadId: 'upload-id',
        partNumbers: [1],
      }),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });

  it('rejects a mismatched upload identity or non-DRAFT state', async () => {
    videoRepository.findOne.mockResolvedValue(
      Object.assign(new Video(), {
        id: VIDEO_ID,
        status: VideoStatus.PROCESSING,
        multipart_upload_id: 'stored-upload',
      }),
    );

    await expect(
      service.signUploadParts(USER_ID, VIDEO_ID, {
        uploadId: 'other-upload',
        partNumbers: [1],
      }),
    ).rejects.toBeInstanceOf(VideoUploadInvalidStateException);
  });

  it('rejects duplicate or out-of-range part numbers', async () => {
    videoRepository.findOne.mockResolvedValue(
      Object.assign(new Video(), {
        id: VIDEO_ID,
        status: VideoStatus.DRAFT,
        multipart_upload_id: 'upload-id',
        size_bytes: '1024',
      }),
    );

    await expect(
      service.signUploadParts(USER_ID, VIDEO_ID, {
        uploadId: 'upload-id',
        partNumbers: [1, 1],
      }),
    ).rejects.toBeInstanceOf(VideoUploadInvalidPartsException);
    await expect(
      service.signUploadParts(USER_ID, VIDEO_ID, {
        uploadId: 'upload-id',
        partNumbers: [2],
      }),
    ).rejects.toBeInstanceOf(VideoUploadInvalidPartsException);
  });

  it('signs valid parts for the owned DRAFT upload', async () => {
    videoRepository.findOne.mockResolvedValue(
      Object.assign(new Video(), {
        id: VIDEO_ID,
        status: VideoStatus.DRAFT,
        multipart_upload_id: 'upload-id',
        size_bytes: '1024',
        source_storage_key: `videos/${VIDEO_ID}/source`,
      }),
    );

    const result = await service.signUploadParts(USER_ID, VIDEO_ID, {
      uploadId: 'upload-id',
      partNumbers: [1],
    });

    expect(result.videoId).toBe(VIDEO_ID);
    expect(result.parts).toHaveLength(1);
    expect(storageService.signUploadParts).toHaveBeenCalledWith(
      `videos/${VIDEO_ID}/source`,
      'upload-id',
      [1],
    );
  });
});
