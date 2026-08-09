import { request } from 'node:http';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { S3StorageService } from './s3-storage.service';
import { StorageModule } from './storage.module';

interface UploadResponse {
  statusCode: number;
  etag?: string;
}

function uploadThroughPublicHost(
  signedUrl: string,
  body: Buffer,
): Promise<UploadResponse> {
  const url = new URL(signedUrl);

  return new Promise((resolve, reject) => {
    const uploadRequest = request(
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
    uploadRequest.on('error', reject);
    uploadRequest.end(body);
  });
}

describe('S3StorageService (integration)', () => {
  let storageService: S3StorageService;
  let config: ConfigType<typeof storageConfig>;
  let activeUpload: { key: string; uploadId: string } | null;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
        }),
        StorageModule,
      ],
    }).compile();
    storageService = moduleRef.get(S3StorageService);
    config = moduleRef.get(storageConfig.KEY);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  afterEach(async () => {
    if (activeUpload) {
      await storageService.abortMultipartUpload(
        activeUpload.key,
        activeUpload.uploadId,
      );
      activeUpload = null;
    }
  });

  it('creates a real multipart upload and signs a public part URL', async () => {
    const key = `tests/multipart-${Date.now()}/source`;
    const uploadId = await storageService.createMultipartUpload(
      key,
      'video/mp4',
    );
    activeUpload = { key, uploadId };

    const signed = await storageService.signUploadParts(key, uploadId, [1]);
    const url = new URL(signed.parts[0].url);

    expect(uploadId).toBeTruthy();
    expect(url.hostname).toBe(new URL(config.publicEndpoint).hostname);
    expect(url.hostname).not.toBe(new URL(config.internalEndpoint).hostname);
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const uploaded = await uploadThroughPublicHost(
      signed.parts[0].url,
      Buffer.from('multipart-test-part'),
    );
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.etag).toBeTruthy();

    const anonymous = await fetch(
      `${config.internalEndpoint}/${config.bucket}/${key}`,
    );
    expect(anonymous.status).toBe(403);
  });
});
