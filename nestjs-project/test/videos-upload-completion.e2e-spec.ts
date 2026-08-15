import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
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
import { OutboxEvent } from '../src/videos/entities/outbox-event.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { VIDEO_PROCESSING_EVENT } from '../src/videos/video.constants';

interface Owner {
  user: User;
  token: string;
}

interface PreparedUpload {
  id: string;
  publicId: string;
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; eTag: string }>;
}

function uploadDirectly(
  signedUrl: string,
  body: Buffer,
): Promise<{ statusCode: number; eTag?: string }> {
  const url = new URL(signedUrl);
  return new Promise((resolve, reject) => {
    const directRequest = httpRequest(
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
    directRequest.on('error', reject);
    directRequest.end(body);
  });
}

function readString(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Expected an HTTP response object');
  }
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected response field ${key} to be a string`);
  }
  return value;
}

function readFirstPartUrl(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Expected an upload-parts response object');
  }
  const parts = (body as Record<string, unknown>).parts;
  if (!Array.isArray(parts) || typeof parts[0] !== 'object' || !parts[0]) {
    throw new Error('Expected at least one signed upload part');
  }
  return readString(parts[0], 'url');
}

describe('videos-upload-completion', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let users: Repository<User>;
  let channels: Repository<Channel>;
  let videos: Repository<Video>;
  let outbox: Repository<OutboxEvent>;
  let jwt: JwtService;
  let throttler: ThrottlerStorageService;
  let s3: S3Client;
  let storage: ConfigType<typeof storageConfig>;
  const createdUploads: Array<{ key: string; uploadId: string }> = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
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

    dataSource = moduleRef.get(DataSource);
    users = dataSource.getRepository(User);
    channels = dataSource.getRepository(Channel);
    videos = dataSource.getRepository(Video);
    outbox = dataSource.getRepository(OutboxEvent);
    jwt = moduleRef.get(JwtService);
    throttler = moduleRef.get<ThrottlerStorageService>(ThrottlerStorage);
    s3 = moduleRef.get(INTERNAL_S3_CLIENT);
    storage = moduleRef.get(storageConfig.KEY);
  });

  beforeEach(async () => {
    await cleanupStorage();
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    throttler.storage.clear();
  });

  afterAll(async () => {
    await cleanupStorage();
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    await app.close();
  });

  async function cleanupStorage(): Promise<void> {
    for (const upload of createdUploads) {
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
    createdUploads.length = 0;
  }

  async function multipartCount(): Promise<number> {
    const result = await s3.send(
      new ListMultipartUploadsCommand({ Bucket: storage.bucket }),
    );
    return result.Uploads?.length ?? 0;
  }

  async function createOwner(label: string): Promise<Owner> {
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
    return {
      user,
      token: jwt.sign({ sub: user.id, email: user.email }),
    };
  }

  async function prepareUpload(
    owner: Owner,
    body: Buffer,
    declaredSize = body.length,
  ): Promise<PreparedUpload> {
    const created = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: 'Upload completion',
        originalFilename: 'source.mp4',
        contentType: 'video/mp4',
        sizeBytes: declaredSize,
      })
      .expect(201);
    const createdBody: unknown = created.body;
    const id = readString(createdBody, 'id');
    const publicId = readString(createdBody, 'publicId');
    const uploadId = readString(createdBody, 'uploadId');
    const key = `videos/${id}/source`;
    createdUploads.push({ key, uploadId });

    const signed = await request(app.getHttpServer())
      .post(`/videos/${id}/upload-parts`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ uploadId, partNumbers: [1] })
      .expect(200);
    const signedBody: unknown = signed.body;
    const uploaded = await uploadDirectly(readFirstPartUrl(signedBody), body);
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.eTag).toBeTruthy();

    return {
      id,
      publicId,
      key,
      uploadId,
      parts: [{ partNumber: 1, eTag: uploaded.eTag! }],
    };
  }

  function complete(owner: Owner, upload: PreparedUpload) {
    return request(app.getHttpServer())
      .post(`/videos/${upload.id}/upload-completion`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ uploadId: upload.uploadId, parts: upload.parts });
  }

  it('concluir-upload-e-criar-comando-de-processamento', async () => {
    const owner = await createOwner('success');
    const body = Buffer.from('successful-video-object');
    const upload = await prepareUpload(owner, body);

    const response = await complete(owner, upload).expect(202);

    const responseBody: unknown = response.body;
    expect(responseBody).toEqual({
      id: upload.id,
      publicId: upload.publicId,
      status: VideoStatus.PROCESSING,
    });
    const object = await s3.send(
      new HeadObjectCommand({ Bucket: storage.bucket, Key: upload.key }),
    );
    expect(object.ContentLength).toBe(body.length);
    const persisted = await videos.findOneByOrFail({ id: upload.id });
    expect(persisted.status).toBe(VideoStatus.PROCESSING);
    expect(persisted.multipart_upload_id).toBeNull();
    expect(persisted.upload_completed_at).toBeInstanceOf(Date);
    const events = await outbox.findBy({ aggregate_id: upload.id });
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe(VIDEO_PROCESSING_EVENT.EVENT_TYPE);
    expect(events[0].payload).toMatchObject({
      eventId: events[0].id,
      videoId: upload.id,
      sourceStorageKey: upload.key,
    });
    expect(typeof events[0].payload.requestedAt).toBe('string');
  });

  it('repetir-conclusao-sem-duplicar-outbox', async () => {
    const owner = await createOwner('retry');
    const upload = await prepareUpload(owner, Buffer.from('retry-video'));

    await complete(owner, upload).expect(202);
    const retry = await complete(owner, upload).expect(202);

    const retryBody: unknown = retry.body;
    expect(readString(retryBody, 'status')).toBe(VideoStatus.PROCESSING);
    await expect(outbox.countBy({ aggregate_id: upload.id })).resolves.toBe(1);
  });

  it('serializar-conclusoes-concorrentes', async () => {
    const owner = await createOwner('concurrent');
    const upload = await prepareUpload(owner, Buffer.from('concurrent-video'));

    const responses = await Promise.all([
      complete(owner, upload),
      complete(owner, upload),
    ]);

    expect(responses.map((response) => response.status)).not.toContain(500);
    expect(responses.map((response) => response.status)).toContain(202);
    const persisted = await videos.findOneByOrFail({ id: upload.id });
    expect(persisted.status).toBe(VideoStatus.PROCESSING);
    await expect(outbox.countBy({ aggregate_id: upload.id })).resolves.toBe(1);
  });

  it('rejeitar-lista-de-partes-invalida', async () => {
    const owner = await createOwner('parts');
    const upload = await prepareUpload(owner, Buffer.from('parts-video'));

    const invalid = await request(app.getHttpServer())
      .post(`/videos/${upload.id}/upload-completion`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        uploadId: upload.uploadId,
        parts: [upload.parts[0], upload.parts[0]],
      })
      .expect(400);
    const invalidBody: unknown = invalid.body;
    expect(readString(invalidBody, 'error')).toBe('VIDEO_UPLOAD_INVALID_PARTS');

    await request(app.getHttpServer())
      .post(`/videos/${upload.id}/upload-completion`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ uploadId: upload.uploadId, parts: [{ partNumber: 1 }] })
      .expect(400);

    const persisted = await videos.findOneByOrFail({ id: upload.id });
    expect(persisted.status).toBe(VideoStatus.DRAFT);
    expect(persisted.multipart_upload_id).toBe(upload.uploadId);
    await expect(outbox.countBy({ aggregate_id: upload.id })).resolves.toBe(0);
  });

  it('rejeitar-objeto-com-tamanho-divergente', async () => {
    const owner = await createOwner('size');
    const body = Buffer.from('short-video');
    const upload = await prepareUpload(owner, body, body.length + 1);

    const response = await complete(owner, upload).expect(422);

    const responseBody: unknown = response.body;
    expect(readString(responseBody, 'error')).toBe(
      'VIDEO_UPLOAD_OBJECT_INVALID',
    );
    const persisted = await videos.findOneByOrFail({ id: upload.id });
    expect(persisted.status).toBe(VideoStatus.DRAFT);
    expect(persisted.multipart_upload_id).toBe(upload.uploadId);
    await expect(outbox.countBy({ aggregate_id: upload.id })).resolves.toBe(0);
  });

  it('ocultar-upload-de-outro-canal', async () => {
    const owner = await createOwner('owner');
    const other = await createOwner('other');
    const upload = await prepareUpload(owner, Buffer.from('private-video'));
    const multipartBefore = await multipartCount();

    const hidden = await complete(other, upload).expect(404);
    const hiddenBody: unknown = hidden.body;
    expect(readString(hiddenBody, 'error')).toBe('VIDEO_NOT_FOUND');
    await request(app.getHttpServer())
      .post(`/videos/${upload.id}/upload-completion`)
      .send({ uploadId: upload.uploadId, parts: upload.parts })
      .expect(401);

    const persisted = await videos.findOneByOrFail({ id: upload.id });
    expect(persisted.status).toBe(VideoStatus.DRAFT);
    expect(persisted.multipart_upload_id).toBe(upload.uploadId);
    await expect(outbox.countBy({ aggregate_id: upload.id })).resolves.toBe(0);
    await expect(multipartCount()).resolves.toBe(multipartBefore);
  });
});
