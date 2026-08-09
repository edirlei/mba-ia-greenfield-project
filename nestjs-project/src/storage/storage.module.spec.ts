import { S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { INTERNAL_S3_CLIENT, PUBLIC_S3_CLIENT } from './storage.constants';
import { StorageModule } from './storage.module';

describe('StorageModule', () => {
  it('should compile with distinct internal and public S3 clients', async () => {
    process.env.STORAGE_ACCESS_KEY = 'streamtube';
    process.env.STORAGE_SECRET_KEY = 'streamtube-secret';
    process.env.STORAGE_INTERNAL_ENDPOINT = 'http://minio:9000';
    process.env.STORAGE_PUBLIC_ENDPOINT = 'http://localhost:9000';

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig],
        }),
        StorageModule,
      ],
    }).compile();

    const internalClient = module.get<S3Client>(INTERNAL_S3_CLIENT);
    const publicClient = module.get<S3Client>(PUBLIC_S3_CLIENT);
    const internalEndpoint = await internalClient.config.endpoint!();
    const publicEndpoint = await publicClient.config.endpoint!();

    expect(internalClient).toBeInstanceOf(S3Client);
    expect(publicClient).toBeInstanceOf(S3Client);
    expect(internalClient).not.toBe(publicClient);
    expect(internalEndpoint.hostname).toBe('minio');
    expect(publicEndpoint.hostname).toBe('localhost');

    internalClient.destroy();
    publicClient.destroy();
    await module.close();
  });
});
