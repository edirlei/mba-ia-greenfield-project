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
import { VideoUploadObjectInvalidException } from '../../common/exceptions/domain.exception';
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
import { VIDEO_PROCESSING_EVENT } from '../video.constants';
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

function uploadPart(
  signedUrl: string,
  body: Buffer,
): Promise<{ statusCode: number; eTag?: string }> {
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
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            eTag: response.headers.etag,
          }),
        );
      },
    );
    uploadRequest.on('error', reject);
    uploadRequest.end(body);
  });
}

describe('VideoCompletionService persistence (integration)', () => {
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
  const uploads: Array<{ key: string; uploadId: string }> = [];

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
    uploads.length = 0;
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
  });

  afterEach(async () => {
    for (const upload of uploads) {
      await s3
        .send(
          new AbortMultipartUploadCommand({
            Bucket: storage.bucket,
            Key: upload.key,
            UploadId: upload.uploadId,
          }),
        )
        .catch(() => undefined);
      await s3.send(
        new DeleteObjectCommand({ Bucket: storage.bucket, Key: upload.key }),
      );
    }
  });

  afterAll(async () => {
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    await moduleRef.close();
  });

  async function createOwner(): Promise<User> {
    const user = await users.save(
      users.create({
        email: `completion-${randomUUID()}@example.com`,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    await channels.save(
      channels.create({
        name: 'Completion owner',
        nickname: `completion-${randomUUID()}`.slice(0, 50),
        user_id: user.id,
      }),
    );
    return user;
  }

  async function prepareUpload(
    userId: string,
    body: Buffer,
    size = body.length,
  ) {
    const created = await uploadService.createUpload(userId, {
      title: 'Completion integration',
      originalFilename: 'source.mp4',
      contentType: 'video/mp4',
      sizeBytes: size,
    });
    const video = await videos.findOneByOrFail({ id: created.id });
    uploads.push({
      key: video.source_storage_key,
      uploadId: created.uploadId,
    });
    const signed = await uploadService.signUploadParts(userId, video.id, {
      uploadId: created.uploadId,
      partNumbers: [1],
    });
    const uploaded = await uploadPart(signed.parts[0].url, body);
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.eTag).toBeTruthy();
    return {
      video,
      dto: {
        uploadId: created.uploadId,
        parts: [{ partNumber: 1, eTag: uploaded.eTag! }],
      },
    };
  }

  it('persists PROCESSING and one outbox event, then retries idempotently', async () => {
    const owner = await createOwner();
    const prepared = await prepareUpload(
      owner.id,
      Buffer.from('integration-video'),
    );

    const first = await completionService.completeUpload(
      owner.id,
      prepared.video.id,
      prepared.dto,
    );
    const retry = await completionService.completeUpload(
      owner.id,
      prepared.video.id,
      prepared.dto,
    );

    const persisted = await videos.findOneByOrFail({ id: prepared.video.id });
    const events = await outbox.findBy({ aggregate_id: prepared.video.id });
    expect(first.status).toBe(VideoStatus.PROCESSING);
    expect(retry.status).toBe(VideoStatus.PROCESSING);
    expect(persisted.status).toBe(VideoStatus.PROCESSING);
    expect(persisted.multipart_upload_id).toBeNull();
    expect(persisted.upload_completed_at).toBeInstanceOf(Date);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe(VIDEO_PROCESSING_EVENT.EVENT_TYPE);
    expect(events[0].payload).toEqual(
      expect.objectContaining({
        eventId: events[0].id,
        videoId: prepared.video.id,
        sourceStorageKey: prepared.video.source_storage_key,
      }),
    );
  });

  it('rolls the database transaction back when object size is invalid', async () => {
    const owner = await createOwner();
    const body = Buffer.from('short');
    const prepared = await prepareUpload(owner.id, body, body.length + 1);

    await expect(
      completionService.completeUpload(
        owner.id,
        prepared.video.id,
        prepared.dto,
      ),
    ).rejects.toBeInstanceOf(VideoUploadObjectInvalidException);

    const persisted = await videos.findOneByOrFail({ id: prepared.video.id });
    expect(persisted.status).toBe(VideoStatus.DRAFT);
    expect(persisted.multipart_upload_id).toBe(prepared.dto.uploadId);
    await expect(
      outbox.countBy({ aggregate_id: prepared.video.id }),
    ).resolves.toBe(0);
  });
});
