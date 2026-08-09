import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Readable } from 'node:stream';
import {
  VideoStorageUnavailableException,
  VideoUploadInvalidPartsException,
  VideoUploadObjectInvalidException,
} from '../common/exceptions/domain.exception';
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

export interface MultipartCompletionPart {
  partNumber: number;
  eTag: string;
}

export interface StoredObjectMetadata {
  contentLength: number;
  eTag?: string;
}

interface S3Error {
  name?: string;
  $metadata?: { httpStatusCode?: number };
}

const isS3Error = (error: unknown, names: string[]): boolean => {
  const s3Error = error as S3Error;
  return s3Error.name !== undefined && names.includes(s3Error.name);
};

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

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: MultipartCompletionPart[],
    expectedSize: number,
  ): Promise<StoredObjectMetadata> {
    try {
      await this.internalClient.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.eTag,
            })),
          },
        }),
      );
    } catch (error) {
      if (
        isS3Error(error, ['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall'])
      ) {
        throw new VideoUploadInvalidPartsException();
      }
      if (!isS3Error(error, ['NoSuchUpload'])) {
        throw new VideoStorageUnavailableException();
      }
    }

    return this.getObjectMetadata(key, expectedSize);
  }

  async getObjectMetadata(
    key: string,
    expectedSize?: number,
  ): Promise<StoredObjectMetadata> {
    try {
      const result = await this.internalClient.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
      if (
        result.ContentLength === undefined ||
        (expectedSize !== undefined && result.ContentLength !== expectedSize)
      ) {
        throw new VideoUploadObjectInvalidException();
      }
      return {
        contentLength: result.ContentLength,
        eTag: result.ETag,
      };
    } catch (error) {
      if (error instanceof VideoUploadObjectInvalidException) {
        throw error;
      }
      const s3Error = error as S3Error;
      if (
        isS3Error(error, ['NotFound', 'NoSuchKey']) ||
        s3Error.$metadata?.httpStatusCode === 404
      ) {
        throw new VideoUploadObjectInvalidException();
      }
      throw new VideoStorageUnavailableException();
    }
  }

  async getObjectStream(key: string): Promise<Readable> {
    try {
      const result = await this.internalClient.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      if (!(result.Body instanceof Readable)) {
        throw new Error('Storage did not return a Node.js readable stream');
      }
      return result.Body;
    } catch {
      throw new VideoStorageUnavailableException();
    }
  }

  async putObject(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<void> {
    try {
      await this.internalClient.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
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
