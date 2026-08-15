import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import storageConfig from '../../config/storage.config';
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
import { VideoUploadService } from './video-upload.service';
import { VideoCompletionService } from './video-completion.service';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  OutboxEvent,
];

function uploadPart(signedUrl: string, body: Buffer): Promise<string> {
  const url = new URL(signedUrl);
  return new Promise((resolve, reject) => {
    const uploadRequest = request(
      {
        hostname: 'host.docker.internal',
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: 'PUT',
        headers: { Host: url.host, 'Content-Length': body.length },
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          const eTag = response.headers.etag;
          if (response.statusCode !== 200 || !eTag) {
            reject(new Error(`Part upload failed with ${response.statusCode}`));
            return;
          }
          resolve(eTag);
        });
      },
    );
    uploadRequest.on('error', reject);
    uploadRequest.end(body);
  });
}

describe('VideoCompletionService concurrency (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let users: Repository<User>;
  let channels: Repository<Channel>;
  let videos: Repository<Video>;
  let outbox: Repository<OutboxEvent>;
  let uploadService: VideoUploadService;
  let completionService: VideoCompletionService;
  let s3: S3Client;
  let storage: ConfigType<typeof storageConfig>;
  let cleanup: { key: string; uploadId: string } | null;

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
    outbox = dataSource.getRepository(OutboxEvent);
    uploadService = moduleRef.get(VideoUploadService);
    completionService = moduleRef.get(VideoCompletionService);
    s3 = moduleRef.get(INTERNAL_S3_CLIENT);
    storage = moduleRef.get(storageConfig.KEY);
  });

  beforeEach(async () => {
    cleanup = null;
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
  });

  afterEach(async () => {
    if (cleanup) {
      await s3
        .send(
          new AbortMultipartUploadCommand({
            Bucket: storage.bucket,
            Key: cleanup.key,
            UploadId: cleanup.uploadId,
          }),
        )
        .catch(() => undefined);
      await s3.send(
        new DeleteObjectCommand({ Bucket: storage.bucket, Key: cleanup.key }),
      );
    }
  });

  afterAll(async () => {
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    await moduleRef.close();
  });

  it('serializes concurrent completion and creates exactly one event', async () => {
    const user = await users.save(
      users.create({
        email: `concurrency-${randomUUID()}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    await channels.save(
      channels.create({
        name: 'Concurrent owner',
        nickname: `concurrent-${randomUUID()}`.slice(0, 50),
        user_id: user.id,
      }),
    );
    const body = Buffer.from('concurrent-video');
    const created = await uploadService.createUpload(user.id, {
      title: 'Concurrent completion',
      originalFilename: 'source.mp4',
      contentType: 'video/mp4',
      sizeBytes: body.length,
    });
    const video = await videos.findOneByOrFail({ id: created.id });
    cleanup = { key: video.source_storage_key, uploadId: created.uploadId };
    const signed = await uploadService.signUploadParts(user.id, video.id, {
      uploadId: created.uploadId,
      partNumbers: [1],
    });
    const eTag = await uploadPart(signed.parts[0].url, body);
    const dto = {
      uploadId: created.uploadId,
      parts: [{ partNumber: 1, eTag }],
    };

    const results = await Promise.all([
      completionService.completeUpload(user.id, video.id, dto),
      completionService.completeUpload(user.id, video.id, dto),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      VideoStatus.PROCESSING,
      VideoStatus.PROCESSING,
    ]);
    await expect(outbox.countBy({ aggregate_id: video.id })).resolves.toBe(1);
    const persisted = await videos.findOneByOrFail({ id: video.id });
    expect(persisted.status).toBe(VideoStatus.PROCESSING);
    expect(persisted.multipart_upload_id).toBeNull();
  });
});
