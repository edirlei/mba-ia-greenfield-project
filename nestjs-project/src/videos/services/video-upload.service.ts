import * as crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import {
  VideoNotFoundException,
  VideoUploadInvalidPartsException,
  VideoUploadInvalidStateException,
  VideoUploadTooLargeException,
} from '../../common/exceptions/domain.exception';
import { S3StorageService } from '../../storage/s3-storage.service';
import type { CreateVideoDto } from '../dto/create-video.dto';
import type { UploadPartsDto } from '../dto/upload-parts.dto';
import type {
  UploadPartsResponseDto,
  VideoUploadResponseDto,
} from '../dto/video-upload-response.dto';
import { Video, VideoStatus } from '../entities/video.entity';
import { VIDEO_UPLOAD } from '../video.constants';

const PG_UNIQUE_VIOLATION = '23505';

interface PostgresError {
  code?: string;
  constraint?: string;
  detail?: string;
}

const isPublicIdCollision = (error: unknown): boolean => {
  const postgresError = error as PostgresError;
  return (
    postgresError.code === PG_UNIQUE_VIOLATION &&
    (postgresError.constraint?.includes('public_id') === true ||
      postgresError.detail?.includes('public_id') === true)
  );
};

@Injectable()
export class VideoUploadService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly storageService: S3StorageService,
  ) {}

  async createUpload(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<VideoUploadResponseDto> {
    if (dto.sizeBytes > VIDEO_UPLOAD.MAX_SIZE_BYTES) {
      throw new VideoUploadTooLargeException();
    }

    const channel = await this.channelRepository.findOne({
      where: { user_id: userId },
    });
    if (!channel) {
      throw new VideoNotFoundException();
    }

    const id = crypto.randomUUID();
    const sourceStorageKey = `videos/${id}/source`;
    const uploadId = await this.storageService.createMultipartUpload(
      sourceStorageKey,
      dto.contentType,
    );
    const video = this.videoRepository.create({
      id,
      channel_id: channel.id,
      title: dto.title,
      original_filename: dto.originalFilename,
      content_type: dto.contentType,
      size_bytes: String(dto.sizeBytes),
      status: VideoStatus.DRAFT,
      source_storage_key: sourceStorageKey,
      multipart_upload_id: uploadId,
      thumbnail_storage_key: null,
      duration_seconds: null,
      metadata: null,
      upload_completed_at: null,
      processing_started_at: null,
      processed_at: null,
      processing_error: null,
    });

    try {
      const saved = await this.saveWithPublicIdRetry(video);
      return {
        id: saved.id,
        publicId: saved.public_id,
        status: saved.status,
        uploadId,
        partSizeBytes: VIDEO_UPLOAD.PART_SIZE_BYTES,
        totalParts: Math.ceil(dto.sizeBytes / VIDEO_UPLOAD.PART_SIZE_BYTES),
        uploadPartUrlTtlSeconds: this.storageService.getUploadUrlTtlSeconds(),
      };
    } catch (error) {
      await this.storageService.abortMultipartUpload(
        sourceStorageKey,
        uploadId,
      );
      throw error;
    }
  }

  async signUploadParts(
    userId: string,
    videoId: string,
    dto: UploadPartsDto,
  ): Promise<UploadPartsResponseDto> {
    const video = await this.videoRepository.findOne({
      where: { id: videoId, channel: { user_id: userId } },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }

    if (
      video.status !== VideoStatus.DRAFT ||
      video.multipart_upload_id === null ||
      video.multipart_upload_id !== dto.uploadId
    ) {
      throw new VideoUploadInvalidStateException();
    }

    const totalParts = Math.ceil(
      Number(video.size_bytes) / VIDEO_UPLOAD.PART_SIZE_BYTES,
    );
    if (!this.arePartNumbersValid(dto.partNumbers, totalParts)) {
      throw new VideoUploadInvalidPartsException();
    }

    const signed = await this.storageService.signUploadParts(
      video.source_storage_key,
      dto.uploadId,
      dto.partNumbers,
    );

    return {
      videoId: video.id,
      uploadId: dto.uploadId,
      expiresAt: signed.expiresAt.toISOString(),
      parts: signed.parts,
    };
  }

  private async saveWithPublicIdRetry(video: Video): Promise<Video> {
    let collisionError: unknown;

    for (
      let attempt = 0;
      attempt < VIDEO_UPLOAD.PUBLIC_ID_MAX_ATTEMPTS;
      attempt++
    ) {
      video.public_id = crypto
        .randomBytes(VIDEO_UPLOAD.PUBLIC_ID_BYTES)
        .toString('base64url');

      try {
        return await this.videoRepository.save(video);
      } catch (error) {
        if (!isPublicIdCollision(error)) {
          throw error;
        }
        collisionError = error;
      }
    }

    throw collisionError;
  }

  private arePartNumbersValid(
    partNumbers: number[],
    totalParts: number,
  ): boolean {
    return (
      partNumbers.length >= 1 &&
      partNumbers.length <= VIDEO_UPLOAD.MAX_SIGNED_PARTS_PER_REQUEST &&
      new Set(partNumbers).size === partNumbers.length &&
      partNumbers.every(
        (partNumber) =>
          Number.isInteger(partNumber) &&
          partNumber >= 1 &&
          partNumber <= totalParts,
      )
    );
  }
}
