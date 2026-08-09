import {
  AbortMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { VideoStorageUnavailableException } from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import { INTERNAL_S3_CLIENT, PUBLIC_S3_CLIENT } from './storage.constants';

export interface SignedUploadPart {
  partNumber: number;
  url: string;
}

export interface SignedUploadParts {
  expiresAt: Date;
  parts: SignedUploadPart[];
}

@Injectable()
export class S3StorageService {
  constructor(
    @Inject(INTERNAL_S3_CLIENT)
    private readonly internalClient: S3Client,
    @Inject(PUBLIC_S3_CLIENT)
    private readonly publicClient: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  getUploadUrlTtlSeconds(): number {
    return this.config.uploadUrlTtlSeconds;
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    try {
      const result = await this.internalClient.send(
        new CreateMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          ContentType: contentType,
        }),
      );

      if (!result.UploadId) {
        throw new Error('Storage did not return a multipart upload ID');
      }

      return result.UploadId;
    } catch {
      throw new VideoStorageUnavailableException();
    }
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.internalClient.send(
        new AbortMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch {
      throw new VideoStorageUnavailableException();
    }
  }

  async signUploadParts(
    key: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<SignedUploadParts> {
    try {
      const parts = await Promise.all(
        partNumbers.map(async (partNumber) => ({
          partNumber,
          url: await getSignedUrl(
            this.publicClient,
            new UploadPartCommand({
              Bucket: this.config.bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: partNumber,
            }),
            { expiresIn: this.config.uploadUrlTtlSeconds },
          ),
        })),
      );

      return {
        expiresAt: new Date(
          Date.now() + this.config.uploadUrlTtlSeconds * 1000,
        ),
        parts,
      };
    } catch {
      throw new VideoStorageUnavailableException();
    }
  }
}
