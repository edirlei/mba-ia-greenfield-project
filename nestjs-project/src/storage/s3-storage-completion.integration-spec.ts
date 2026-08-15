import { request } from 'node:http';
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  VideoUploadInvalidPartsException,
  VideoUploadObjectInvalidException,
} from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import { S3StorageService } from './s3-storage.service';
import { INTERNAL_S3_CLIENT } from './storage.constants';
import { StorageModule } from './storage.module';

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

describe('S3StorageService upload completion (integration)', () => {
  let moduleRef: TestingModule;
  let service: S3StorageService;
  let client: S3Client;
  let config: ConfigType<typeof storageConfig>;
  const uploads: Array<{ key: string; uploadId: string }> = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    service = moduleRef.get(S3StorageService);
    client = moduleRef.get(INTERNAL_S3_CLIENT);
    config = moduleRef.get(storageConfig.KEY);
  });

  afterEach(async () => {
    for (const upload of uploads) {
      await client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: config.bucket,
            Key: upload.key,
            UploadId: upload.uploadId,
          }),
        )
        .catch(() => undefined);
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: upload.key }),
      );
    }
    uploads.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function createUploadedPart(body: Buffer) {
    const key = `tests/completion-${Date.now()}-${Math.random()}/source`;
    const uploadId = await service.createMultipartUpload(key, 'video/mp4');
    uploads.push({ key, uploadId });
    const signed = await service.signUploadParts(key, uploadId, [1]);
    const uploaded = await uploadPart(signed.parts[0].url, body);
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.eTag).toBeTruthy();
    return { key, uploadId, eTag: uploaded.eTag! };
  }

  it('completes, verifies and recovers an already consumed upload ID', async () => {
    const body = Buffer.from('completed-video-object');
    const upload = await createUploadedPart(body);
    const parts = [{ partNumber: 1, eTag: upload.eTag }];

    const first = await service.completeMultipartUpload(
      upload.key,
      upload.uploadId,
      parts,
      body.length,
    );
    const retry = await service.completeMultipartUpload(
      upload.key,
      upload.uploadId,
      parts,
      body.length,
    );

    expect(first.contentLength).toBe(body.length);
    expect(retry.contentLength).toBe(body.length);
  });

  it('maps invalid ETags to the multipart parts domain error', async () => {
    const upload = await createUploadedPart(Buffer.from('invalid-etag'));

    await expect(
      service.completeMultipartUpload(
        upload.key,
        upload.uploadId,
        [{ partNumber: 1, eTag: '"not-the-uploaded-etag"' }],
        12,
      ),
    ).rejects.toBeInstanceOf(VideoUploadInvalidPartsException);
  });

  it('rejects a completed object whose size differs from the declaration', async () => {
    const body = Buffer.from('short-object');
    const upload = await createUploadedPart(body);

    await expect(
      service.completeMultipartUpload(
        upload.key,
        upload.uploadId,
        [{ partNumber: 1, eTag: upload.eTag }],
        body.length + 1,
      ),
    ).rejects.toBeInstanceOf(VideoUploadObjectInvalidException);
  });
});
