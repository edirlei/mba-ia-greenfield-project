import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { INTERNAL_S3_CLIENT, PUBLIC_S3_CLIENT } from './storage.constants';

const createS3Client = (
  endpoint: string,
  config: ConfigType<typeof storageConfig>,
): S3Client =>
  new S3Client({
    endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: INTERNAL_S3_CLIENT,
      inject: [storageConfig.KEY],
      useFactory: (config: ConfigType<typeof storageConfig>) =>
        createS3Client(config.internalEndpoint, config),
    },
    {
      provide: PUBLIC_S3_CLIENT,
      inject: [storageConfig.KEY],
      useFactory: (config: ConfigType<typeof storageConfig>) =>
        createS3Client(config.publicEndpoint, config),
    },
  ],
  exports: [INTERNAL_S3_CLIENT, PUBLIC_S3_CLIENT],
})
export class StorageModule {}
