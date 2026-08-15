import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { VideoNotFoundException } from '../../common/exceptions/domain.exception';
import storageConfig from '../../config/storage.config';
import { S3StorageService } from '../../storage/s3-storage.service';
import {
  cleanAllTables,
  cleanVideoTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideosModule } from '../videos.module';
import { VideoUploadService } from './video-upload.service';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  OutboxEvent,
];

describe('VideoUploadService persistence (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let service: VideoUploadService;
  let storageService: S3StorageService;
  let activeUploads: Array<{ key: string; uploadId: string }>;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    }).compile();
    dataSource = moduleRef.get(DataSource);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    service = moduleRef.get(VideoUploadService);
    storageService = moduleRef.get(S3StorageService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    activeUploads = [];
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
  });

  afterEach(async () => {
    for (const upload of activeUploads) {
      await storageService.abortMultipartUpload(upload.key, upload.uploadId);
    }
  });

  async function createOwner(): Promise<{ user: User; channel: Channel }> {
    const suffix = randomUUID();
    const user = await userRepository.save(
      userRepository.create({
        email: `owner-${suffix}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Owner channel',
        nickname: `owner-${suffix}`.slice(0, 50),
        user_id: user.id,
      }),
    );
    return { user, channel };
  }

  async function createUpload(userId: string, title: string): Promise<Video> {
    const result = await service.createUpload(userId, {
      title,
      originalFilename: 'source.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1024,
    });
    const video = await videoRepository.findOneOrFail({
      where: { id: result.id },
      relations: ['channel'],
    });
    activeUploads.push({
      key: video.source_storage_key,
      uploadId: result.uploadId,
    });
    return video;
  }

  it('persists one owned DRAFT and an immutable multipart session', async () => {
    const { user, channel } = await createOwner();
    const first = await createUpload(user.id, 'First video');
    const second = await createUpload(user.id, 'Second video');

    expect(first.channel.id).toBe(channel.id);
    expect(first.status).toBe(VideoStatus.DRAFT);
    expect(first.multipart_upload_id).toBeTruthy();
    expect(first.source_storage_key).toBe(`videos/${first.id}/source`);
    expect(first.public_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first.public_id).not.toBe(second.public_id);
    expect(first.source_storage_key).not.toBe(second.source_storage_key);
    await expect(videoRepository.count()).resolves.toBe(2);
  });

  it('renews valid parts while hiding the upload from another owner', async () => {
    const owner = await createOwner();
    const video = await createUpload(owner.user.id, 'Owned video');

    const signed = await service.signUploadParts(owner.user.id, video.id, {
      uploadId: video.multipart_upload_id!,
      partNumbers: [1],
    });
    expect(signed.parts[0].partNumber).toBe(1);
    expect(new URL(signed.parts[0].url).hostname).toBe('localhost');

    const otherOwner = await createOwner();
    await expect(
      service.signUploadParts(otherOwner.user.id, video.id, {
        uploadId: video.multipart_upload_id!,
        partNumbers: [1],
      }),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });
});
