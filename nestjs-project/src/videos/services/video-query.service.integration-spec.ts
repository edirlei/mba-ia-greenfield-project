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
import {
  cleanAllTables,
  cleanVideoTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideosModule } from '../videos.module';
import { VideoQueryService } from './video-query.service';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  OutboxEvent,
];

describe('VideoQueryService owner lookup (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let users: Repository<User>;
  let channels: Repository<Channel>;
  let videos: Repository<Video>;
  let service: VideoQueryService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    }).compile();
    dataSource = moduleRef.get(DataSource);
    users = dataSource.getRepository(User);
    channels = dataSource.getRepository(Channel);
    videos = dataSource.getRepository(Video);
    service = moduleRef.get(VideoQueryService);
  });

  beforeEach(async () => {
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
  });

  afterAll(async () => {
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    await moduleRef.close();
  });

  async function owner(label: string): Promise<User> {
    const user = await users.save(
      users.create({
        email: `${label}-${randomUUID()}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    await channels.save(
      channels.create({
        name: `${label} channel`,
        nickname: `${label}-${randomUUID()}`.slice(0, 50),
        user_id: user.id,
      }),
    );
    return user;
  }

  async function createVideo(user: User, publicId: string): Promise<Video> {
    const channel = await channels.findOneByOrFail({ user_id: user.id });
    const id = randomUUID();
    return videos.save(
      videos.create({
        id,
        channel_id: channel.id,
        public_id: publicId,
        title: 'Owner query',
        original_filename: 'owner.mp4',
        content_type: 'video/mp4',
        size_bytes: '2048',
        status: VideoStatus.READY,
        source_storage_key: `videos/${id}/source`,
        thumbnail_storage_key: `videos/${id}/thumbnails/default.jpg`,
        multipart_upload_id: null,
        duration_seconds: '1.250',
        metadata: null,
        upload_completed_at: new Date(),
        processing_started_at: new Date(),
        processed_at: new Date(),
        processing_error: null,
      }),
    );
  }

  it('finds by public ID only through the authenticated channel relation', async () => {
    const first = await owner('first');
    const second = await owner('second');
    const video = await createVideo(first, 'OwnerPublicId123456789');

    const result = await service.getDetails(first.id, video.public_id);

    expect(result.id).toBe(video.id);
    expect(result.publicId).toBe(video.public_id);
    await expect(
      service.getDetails(second.id, video.public_id),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    await expect(
      service.getDetails(first.id, 'MissingPublicId1234567'),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
  });
});
