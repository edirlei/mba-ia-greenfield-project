import { randomUUID } from 'node:crypto';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { VideoNotReadyException } from '../../common/exceptions/domain.exception';
import storageConfig from '../../config/storage.config';
import { S3StorageService } from '../../storage/s3-storage.service';
import { INTERNAL_S3_CLIENT } from '../../storage/storage.constants';
import {
  cleanAllTables,
  cleanVideoTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideosModule } from '../videos.module';
import { VideoMediaAccessService } from './video-media-access.service';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  OutboxEvent,
];

interface StorageResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function getFromStorage(
  signedUrl: string,
  headers: Record<string, string> = {},
): Promise<StorageResponse> {
  const url = new URL(signedUrl);
  return new Promise((resolve, reject) => {
    const directRequest = httpRequest(
      {
        hostname: 'host.docker.internal',
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { Host: url.host, ...headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    directRequest.on('error', reject);
    directRequest.end();
  });
}

describe('VideoMediaAccessService private storage (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let users: Repository<User>;
  let channels: Repository<Channel>;
  let videos: Repository<Video>;
  let service: VideoMediaAccessService;
  let storageService: S3StorageService;
  let s3: S3Client;
  let storage: ConfigType<typeof storageConfig>;
  const objectKeys: string[] = [];
  const source = Buffer.from(
    Array.from({ length: 2048 }, (_, index) => index % 251),
  );
  const thumbnail = Buffer.from('known-jpeg-thumbnail');

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
    service = moduleRef.get(VideoMediaAccessService);
    storageService = moduleRef.get(S3StorageService);
    s3 = moduleRef.get(INTERNAL_S3_CLIENT);
    storage = moduleRef.get(storageConfig.KEY);
  });

  beforeEach(async () => {
    await cleanStorage();
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
  });

  afterAll(async () => {
    await cleanStorage();
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    await moduleRef.close();
  });

  async function cleanStorage(): Promise<void> {
    await Promise.all(
      objectKeys.map((key) =>
        s3.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key })),
      ),
    );
    objectKeys.length = 0;
  }

  async function createOwner(): Promise<User> {
    const user = await users.save(
      users.create({
        email: `media-${randomUUID()}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    await channels.save(
      channels.create({
        name: 'Media owner',
        nickname: `media-${randomUUID()}`.slice(0, 50),
        user_id: user.id,
      }),
    );
    return user;
  }

  async function createReadyVideo(user: User): Promise<Video> {
    const channel = await channels.findOneByOrFail({ user_id: user.id });
    const id = randomUUID();
    const sourceKey = `videos/${id}/source`;
    const thumbnailKey = `videos/${id}/thumbnails/default.jpg`;
    objectKeys.push(sourceKey, thumbnailKey);
    await storageService.putObject(sourceKey, source, 'video/mp4');
    await storageService.putObject(thumbnailKey, thumbnail, 'image/jpeg');
    return videos.save(
      videos.create({
        id,
        channel_id: channel.id,
        public_id: randomUUID().replaceAll('-', '').slice(0, 22),
        title: 'Private media',
        original_filename: '../My video "final"?.mp4',
        content_type: 'video/mp4',
        size_bytes: String(source.length),
        status: VideoStatus.READY,
        source_storage_key: sourceKey,
        thumbnail_storage_key: thumbnailKey,
        multipart_upload_id: null,
        duration_seconds: '1.500',
        metadata: null,
        upload_completed_at: new Date(),
        processing_started_at: new Date(),
        processed_at: new Date(),
        processing_error: null,
      }),
    );
  }

  it('signs inline source access and lets MinIO serve a byte range', async () => {
    const owner = await createOwner();
    const video = await createReadyVideo(owner);

    const signedUrl = await service.getStreamUrl(owner.id, video.public_id);
    const url = new URL(signedUrl);
    const response = await getFromStorage(signedUrl, {
      Range: 'bytes=0-1023',
    });

    expect(url.hostname).toBe(new URL(storage.publicEndpoint).hostname);
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.get('response-content-disposition')).toBe('inline');
    expect(response.statusCode).toBe(206);
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-range']).toBe('bytes 0-1023/2048');
    expect(response.headers['content-length']).toBe('1024');
    expect(response.body).toEqual(source.subarray(0, 1024));
  });

  it('signs attachment access with a sanitized filename and full source bytes', async () => {
    const owner = await createOwner();
    const video = await createReadyVideo(owner);

    const signedUrl = await service.getDownloadUrl(owner.id, video.public_id);
    const response = await getFromStorage(signedUrl);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="My video _final__.mp4"',
    );
    expect(response.body).toEqual(source);
  });

  it('serves a signed JPEG thumbnail while unsigned access stays private', async () => {
    const owner = await createOwner();
    const video = await createReadyVideo(owner);

    const signedUrl = await service.getThumbnailUrl(owner.id, video.public_id);
    const signed = await getFromStorage(signedUrl);
    const unsignedUrl = new URL(signedUrl);
    unsignedUrl.search = '';
    const unsigned = await getFromStorage(unsignedUrl.toString());

    expect(signed.statusCode).toBe(200);
    expect(signed.headers['content-type']).toBe('image/jpeg');
    expect(signed.headers['content-disposition']).toBe('inline');
    expect(signed.body).toEqual(thumbnail);
    expect(unsigned.statusCode).toBe(403);
  });

  it('rejects source or thumbnail access until every required artifact is ready', async () => {
    const owner = await createOwner();
    const video = await createReadyVideo(owner);
    video.status = VideoStatus.PROCESSING;
    await videos.save(video);

    await expect(
      service.getStreamUrl(owner.id, video.public_id),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
    await expect(
      service.getDownloadUrl(owner.id, video.public_id),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
    await expect(
      service.getThumbnailUrl(owner.id, video.public_id),
    ).rejects.toBeInstanceOf(VideoNotReadyException);

    video.status = VideoStatus.READY;
    video.thumbnail_storage_key = null;
    await videos.save(video);
    await expect(
      service.getThumbnailUrl(owner.id, video.public_id),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
  });
});
