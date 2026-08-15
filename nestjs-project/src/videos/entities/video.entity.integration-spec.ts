import { randomBytes, randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  cleanVideoTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { OutboxEvent } from './outbox-event.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  OutboxEvent,
];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
  });

  async function createChannel(): Promise<Channel> {
    const suffix = randomUUID();
    const user = await userRepository.save(
      userRepository.create({
        email: `video-${suffix}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: 'Video channel',
        nickname: `video-${suffix}`.slice(0, 50),
        user_id: user.id,
      }),
    );
  }

  function buildVideo(
    channelId: string,
    overrides: Partial<Video> = {},
  ): Video {
    const id = randomUUID();
    return videoRepository.create({
      id,
      channel_id: channelId,
      public_id: randomBytes(16).toString('base64url'),
      title: 'Video title',
      original_filename: 'video.mp4',
      content_type: 'video/mp4',
      size_bytes: '1024',
      source_storage_key: `videos/${id}/source`,
      multipart_upload_id: `upload-${id}`,
      ...overrides,
    });
  }

  it('persists DRAFT defaults, bigint safely and the channel relation', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel.id));

    const found = await videoRepository.findOneOrFail({
      where: { id: saved.id },
      relations: ['channel'],
    });

    expect(found.status).toBe(VideoStatus.DRAFT);
    expect(found.size_bytes).toBe('1024');
    expect(found.channel.id).toBe(channel.id);
    expect(found.thumbnail_storage_key).toBeNull();
    expect(found.duration_seconds).toBeNull();
    expect(found.metadata).toBeNull();
    expect(found.created_at).toBeInstanceOf(Date);
    expect(found.updated_at).toBeInstanceOf(Date);
  });

  it('enforces unique public, source and non-null thumbnail keys', async () => {
    const channel = await createChannel();
    const first = await videoRepository.save(
      buildVideo(channel.id, {
        thumbnail_storage_key: 'videos/thumbnail/default.jpg',
      }),
    );

    await expect(
      videoRepository.save(
        buildVideo(channel.id, { public_id: first.public_id }),
      ),
    ).rejects.toThrow();
    await expect(
      videoRepository.save(
        buildVideo(channel.id, {
          source_storage_key: first.source_storage_key,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      videoRepository.save(
        buildVideo(channel.id, {
          thumbnail_storage_key: first.thumbnail_storage_key,
        }),
      ),
    ).rejects.toThrow();
  });

  it('creates the required query indexes', async () => {
    const rows = await dataSource.query<
      { indexname: string; indexdef: string }[]
    >(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'videos'`);
    const definitions = rows.map((row) => row.indexdef).join('\n');

    expect(definitions).toContain('(channel_id)');
    expect(definitions).toContain('(status)');
    expect(definitions).toContain('(channel_id, created_at)');
    expect(definitions).toContain('WHERE (thumbnail_storage_key IS NOT NULL)');
  });

  it('deletes videos when their channel is deleted', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(buildVideo(channel.id));

    await channelRepository.delete(channel.id);

    await expect(
      videoRepository.findOneBy({ id: video.id }),
    ).resolves.toBeNull();
  });
});
