import { request as httpRequest } from 'node:http';
import {
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource, type Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import storageConfig from '../src/config/storage.config';
import { INTERNAL_S3_CLIENT } from '../src/storage/storage.constants';
import {
  cleanAllTables,
  cleanVideoTables,
} from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { VIDEO_UPLOAD } from '../src/videos/video.constants';

interface DirectUploadResponse {
  statusCode: number;
  etag?: string;
}

function uploadDirectlyToSignedUrl(
  signedUrl: string,
  body: Buffer,
): Promise<DirectUploadResponse> {
  const url = new URL(signedUrl);

  return new Promise((resolve, reject) => {
    const directRequest = httpRequest(
      {
        hostname: 'host.docker.internal',
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: 'PUT',
        headers: {
          Host: url.host,
          'Content-Length': body.length,
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            etag: response.headers.etag,
          });
        });
      },
    );
    directRequest.on('error', reject);
    directRequest.end(body);
  });
}

describe('videos-upload', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let jwtService: JwtService;
  let throttlerStorage: ThrottlerStorageService;
  let internalS3Client: S3Client;
  let storage: ConfigType<typeof storageConfig>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    jwtService = moduleFixture.get(JwtService);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
    internalS3Client = moduleFixture.get<S3Client>(INTERNAL_S3_CLIENT);
    storage = moduleFixture.get(storageConfig.KEY);
  });

  afterAll(async () => {
    await abortAllMultipartUploads();
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    await app.close();
  });

  beforeEach(async () => {
    await abortAllMultipartUploads();
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function abortAllMultipartUploads(): Promise<void> {
    const uploads = await internalS3Client.send(
      new ListMultipartUploadsCommand({ Bucket: storage.bucket }),
    );
    for (const upload of uploads.Uploads ?? []) {
      if (!upload.Key || !upload.UploadId) continue;
      await internalS3Client.send(
        new AbortMultipartUploadCommand({
          Bucket: storage.bucket,
          Key: upload.Key,
          UploadId: upload.UploadId,
        }),
      );
    }
  }

  async function activeMultipartUploadCount(): Promise<number> {
    const result = await internalS3Client.send(
      new ListMultipartUploadsCommand({ Bucket: storage.bucket }),
    );
    return result.Uploads?.length ?? 0;
  }

  async function createAuthenticatedOwner(
    email: string,
  ): Promise<{ user: User; channel: Channel; token: string }> {
    const user = await userRepository.save(
      userRepository.create({
        email,
        password: 'hashed',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: email.split('@')[0],
        nickname: `channel-${user.id}`.slice(0, 50),
        user_id: user.id,
      }),
    );
    return {
      user,
      channel,
      token: jwtService.sign({ sub: user.id, email: user.email }),
    };
  }

  it('criar-sessao-multipart-em-rascunho', async () => {
    const owner = await createAuthenticatedOwner('draft@example.com');
    const payload = {
      title: 'Ten gigabyte video',
      originalFilename: 'video.mp4',
      contentType: 'video/mp4',
      sizeBytes: VIDEO_UPLOAD.MAX_SIZE_BYTES,
    };

    const first = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.token}`)
      .send(payload)
      .expect(201);

    expect(first.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        publicId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        status: VideoStatus.DRAFT,
        uploadId: expect.any(String),
        partSizeBytes: 67_108_864,
        totalParts: 160,
        uploadPartUrlTtlSeconds: expect.any(Number),
      }),
    );
    expect(first.body.uploadPartUrlTtlSeconds).toBeGreaterThan(0);

    const persisted = await videoRepository.findOneOrFail({
      where: { id: first.body.id },
      relations: ['channel'],
    });
    expect(persisted.channel.id).toBe(owner.channel.id);
    expect(persisted.source_storage_key).toBe(`videos/${first.body.id}/source`);

    const second = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ...payload, title: 'Second video', sizeBytes: 1024 })
      .expect(201);
    expect(second.body.publicId).not.toBe(first.body.publicId);

    await request(app.getHttpServer())
      .post('/videos')
      .send(payload)
      .expect(401);
    await expect(videoRepository.count()).resolves.toBe(2);
  });

  it('rejeitar-tamanho-ou-tipo-invalido', async () => {
    const owner = await createAuthenticatedOwner('invalid@example.com');

    const tooLarge = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Too large',
        originalFilename: 'large.mp4',
        contentType: 'video/mp4',
        sizeBytes: VIDEO_UPLOAD.MAX_SIZE_BYTES + 1,
      })
      .expect(413);
    expect(tooLarge.body).toEqual({
      statusCode: 413,
      error: 'VIDEO_UPLOAD_TOO_LARGE',
      message: 'Video size exceeds the 10 GB upload limit',
    });

    await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Invalid type',
        originalFilename: 'binary.bin',
        contentType: 'application/octet-stream',
        sizeBytes: 1024,
      })
      .expect(400);

    await expect(videoRepository.count()).resolves.toBe(0);
    await expect(activeMultipartUploadCount()).resolves.toBe(0);
  });

  it('assinar-parte-no-endpoint-publico', async () => {
    const owner = await createAuthenticatedOwner('parts@example.com');
    const created = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Parts video',
        originalFilename: 'parts.mp4',
        contentType: 'video/mp4',
        sizeBytes: 1024,
      })
      .expect(201);

    const signed = await request(app.getHttpServer())
      .post(`/videos/${created.body.id}/upload-parts`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ uploadId: created.body.uploadId, partNumbers: [1] })
      .expect(200);

    expect(signed.body.videoId).toBe(created.body.id);
    expect(signed.body.uploadId).toBe(created.body.uploadId);
    expect(new Date(signed.body.expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(signed.body.parts).toHaveLength(1);
    expect(new URL(signed.body.parts[0].url).hostname).toBe('localhost');

    const uploaded = await uploadDirectlyToSignedUrl(
      signed.body.parts[0].url,
      Buffer.from('video-part-content'),
    );
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.etag).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/videos/${created.body.id}/upload-parts`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ uploadId: created.body.uploadId, partNumbers: [2] })
      .expect(400);
  });

  it('renovar-parte-e-ocultar-video-de-outro-canal', async () => {
    const owner = await createAuthenticatedOwner('owner@example.com');
    const created = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Renewable video',
        originalFilename: 'renew.mp4',
        contentType: 'video/mp4',
        sizeBytes: 1024,
      })
      .expect(201);
    const body = { uploadId: created.body.uploadId, partNumbers: [1] };

    const first = await request(app.getHttpServer())
      .post(`/videos/${created.body.id}/upload-parts`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(body)
      .expect(200);
    const renewed = await request(app.getHttpServer())
      .post(`/videos/${created.body.id}/upload-parts`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(body)
      .expect(200);
    expect(first.body.parts[0].url).toBeTruthy();
    expect(renewed.body.parts[0].url).toBeTruthy();
    await expect(videoRepository.count()).resolves.toBe(1);

    const other = await createAuthenticatedOwner('other@example.com');
    const hidden = await request(app.getHttpServer())
      .post(`/videos/${created.body.id}/upload-parts`)
      .set('Authorization', `Bearer ${other.token}`)
      .send(body)
      .expect(404);
    expect(hidden.body.error).toBe('VIDEO_NOT_FOUND');

    await request(app.getHttpServer())
      .post(`/videos/${created.body.id}/upload-parts`)
      .send(body)
      .expect(401);
  });
});
