import { randomUUID } from 'node:crypto';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
import { S3StorageService } from '../src/storage/s3-storage.service';
import { INTERNAL_S3_CLIENT } from '../src/storage/storage.constants';
import {
  cleanAllTables,
  cleanVideoTables,
} from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';

interface Owner {
  user: User;
  token: string;
}

interface StorageResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface VideoFixture {
  video: Video;
  source: Buffer;
  thumbnail: Buffer;
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

describe('videos-media-access', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let users: Repository<User>;
  let channels: Repository<Channel>;
  let videos: Repository<Video>;
  let jwt: JwtService;
  let throttler: ThrottlerStorageService;
  let storageService: S3StorageService;
  let s3: S3Client;
  let storage: ConfigType<typeof storageConfig>;
  const objectKeys: string[] = [];

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
    jwt = moduleRef.get(JwtService);
    throttler = moduleRef.get<ThrottlerStorageService>(ThrottlerStorage);
    storageService = moduleRef.get(S3StorageService);
    s3 = moduleRef.get(INTERNAL_S3_CLIENT);
    storage = moduleRef.get(storageConfig.KEY);
  });

  beforeEach(async () => {
    await cleanStorage();
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    throttler.storage.clear();
  });

  afterAll(async () => {
    await cleanStorage();
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
    await app.close();
  });

  async function cleanStorage(): Promise<void> {
    await Promise.all(
      objectKeys.map((key) =>
        s3.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key })),
      ),
    );
    objectKeys.length = 0;
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

  async function createVideo(
    owner: Owner,
    status: VideoStatus,
    withObjects = status === VideoStatus.READY,
  ): Promise<VideoFixture> {
    const channel = await channels.findOneByOrFail({ user_id: owner.user.id });
    const id = randomUUID();
    const sourceKey = `videos/${id}/source`;
    const thumbnailKey = `videos/${id}/thumbnails/default.jpg`;
    const source = Buffer.from(
      Array.from({ length: 2048 }, (_, index) => index % 251),
    );
    const thumbnail = Buffer.from('known-e2e-jpeg-thumbnail');
    if (withObjects) {
      objectKeys.push(sourceKey, thumbnailKey);
      await storageService.putObject(sourceKey, source, 'video/mp4');
      await storageService.putObject(thumbnailKey, thumbnail, 'image/jpeg');
    }
    const video = await videos.save(
      videos.create({
        id,
        channel_id: channel.id,
        public_id: randomUUID().replaceAll('-', '').slice(0, 22),
        title: 'Media access E2E',
        original_filename: '../My video "final"?.mp4',
        content_type: 'video/mp4',
        size_bytes: String(source.length),
        status,
        source_storage_key: sourceKey,
        thumbnail_storage_key: thumbnailKey,
        multipart_upload_id: null,
        duration_seconds: status === VideoStatus.READY ? '1.500' : null,
        metadata:
          status === VideoStatus.READY
            ? {
                formatName: 'mov,mp4',
                formatLongName: 'QuickTime / MOV',
                bitRate: 10_000,
                videoCodec: 'h264',
                width: 1280,
                height: 720,
                frameRate: 30,
              }
            : null,
        upload_completed_at: status === VideoStatus.DRAFT ? null : new Date(),
        processing_started_at: status === VideoStatus.DRAFT ? null : new Date(),
        processed_at: status === VideoStatus.READY ? new Date() : null,
        processing_error:
          status === VideoStatus.ERROR ? 'internal ffmpeg detail' : null,
      }),
    );
    return { video, source, thumbnail };
  }

  function apiGet(owner: Owner, path: string) {
    return request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${owner.token}`);
  }

  it('consultar-metadata-segura-do-proprio-video', async () => {
    const owner = await createOwner('details');
    const fixture = await createVideo(owner, VideoStatus.READY);

    const response = await apiGet(
      owner,
      `/videos/${fixture.video.public_id}`,
    ).expect(200);
    const body: unknown = response.body;

    expect(body).toEqual({
      id: fixture.video.id,
      publicId: fixture.video.public_id,
      title: fixture.video.title,
      originalFilename: fixture.video.original_filename,
      contentType: fixture.video.content_type,
      sizeBytes: fixture.source.length,
      status: VideoStatus.READY,
      durationSeconds: 1.5,
      metadata: fixture.video.metadata,
      thumbnailAvailable: true,
      createdAt: fixture.video.created_at.toISOString(),
      updatedAt: fixture.video.updated_at.toISOString(),
    });
    expect(body).not.toHaveProperty('sourceStorageKey');
    expect(body).not.toHaveProperty('thumbnailStorageKey');
    expect(body).not.toHaveProperty('multipartUploadId');
    expect(body).not.toHaveProperty('processingError');
    await request(app.getHttpServer())
      .get(`/videos/${fixture.video.public_id}`)
      .expect(401);
  });

  it('ocultar-video-de-outro-canal-em-todas-as-rotas', async () => {
    const owner = await createOwner('owner');
    const other = await createOwner('other');
    const fixture = await createVideo(owner, VideoStatus.READY);
    const suffixes = ['', '/stream', '/download', '/thumbnail'];

    for (const suffix of suffixes) {
      const response = await apiGet(
        other,
        `/videos/${fixture.video.public_id}${suffix}`,
      ).expect(404);
      const body: unknown = response.body;
      expect(readString(body, 'error')).toBe('VIDEO_NOT_FOUND');
      expect(body).not.toHaveProperty('url');
      expect(body).not.toHaveProperty('status');
      expect(body).not.toHaveProperty('owner');
    }
  });

  it('bloquear-midia-antes-de-ready', async () => {
    const owner = await createOwner('not-ready');

    for (const status of [
      VideoStatus.DRAFT,
      VideoStatus.PROCESSING,
      VideoStatus.ERROR,
    ]) {
      const fixture = await createVideo(owner, status, false);
      for (const suffix of ['/stream', '/download', '/thumbnail']) {
        const response = await apiGet(
          owner,
          `/videos/${fixture.video.public_id}${suffix}`,
        ).expect(409);
        expect(readString(response.body as unknown, 'error')).toBe(
          'VIDEO_NOT_READY',
        );
      }
    }
  });

  it('redirecionar-stream-com-disposicao-inline', async () => {
    const owner = await createOwner('stream');
    const fixture = await createVideo(owner, VideoStatus.READY);

    const response = await apiGet(
      owner,
      `/videos/${fixture.video.public_id}/stream`,
    ).expect(307);
    const location = response.headers.location;
    const url = new URL(location);

    expect(url.hostname).toBe(new URL(storage.publicEndpoint).hostname);
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.get('X-Amz-Expires')).toBe(
      String(storage.readUrlTtlSeconds),
    );
    expect(url.searchParams.get('response-content-disposition')).toBe('inline');
    expect(Buffer.from(response.text)).not.toEqual(fixture.source);
  });

  it('consumir-range-diretamente-do-storage', async () => {
    const owner = await createOwner('range');
    const fixture = await createVideo(owner, VideoStatus.READY);
    const redirect = await apiGet(
      owner,
      `/videos/${fixture.video.public_id}/stream`,
    ).expect(307);

    const response = await getFromStorage(redirect.headers.location, {
      Range: 'bytes=0-1023',
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-range']).toBe('bytes 0-1023/2048');
    expect(response.headers['content-length']).toBe('1024');
    expect(response.body).toEqual(fixture.source.subarray(0, 1024));
  });

  it('redirecionar-download-com-nome-sanitizado', async () => {
    const owner = await createOwner('download');
    const fixture = await createVideo(owner, VideoStatus.READY);
    const redirect = await apiGet(
      owner,
      `/videos/${fixture.video.public_id}/download`,
    ).expect(307);

    const response = await getFromStorage(redirect.headers.location);

    expect(new URL(redirect.headers.location).pathname).toContain(
      fixture.video.source_storage_key,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="My video _final__.mp4"',
    );
    expect(response.body).toEqual(fixture.source);
  });

  it('entregar-thumbnail-sem-publicar-bucket', async () => {
    const owner = await createOwner('thumbnail');
    const fixture = await createVideo(owner, VideoStatus.READY);
    const redirect = await apiGet(
      owner,
      `/videos/${fixture.video.public_id}/thumbnail`,
    ).expect(307);

    const signed = await getFromStorage(redirect.headers.location);
    const unsignedUrl = new URL(redirect.headers.location);
    unsignedUrl.search = '';
    const unsigned = await getFromStorage(unsignedUrl.toString());

    expect(signed.statusCode).toBe(200);
    expect(signed.headers['content-type']).toBe('image/jpeg');
    expect(signed.headers['content-disposition']).toBe('inline');
    expect(signed.body).toEqual(fixture.thumbnail);
    expect(unsigned.statusCode).toBe(403);
  });
});
