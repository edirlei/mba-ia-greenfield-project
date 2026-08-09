import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  VideoNotFoundException,
  VideoUploadInvalidPartsException,
  VideoUploadInvalidStateException,
} from '../../common/exceptions/domain.exception';
import { S3StorageService } from '../../storage/s3-storage.service';
import type { CompleteVideoUploadDto } from '../dto/complete-video-upload.dto';
import type { VideoCompletionResponseDto } from '../dto/video-completion-response.dto';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { VIDEO_PROCESSING_EVENT, VIDEO_UPLOAD } from '../video.constants';

@Injectable()
export class VideoCompletionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: S3StorageService,
  ) {}

  async completeUpload(
    userId: string,
    videoId: string,
    dto: CompleteVideoUploadDto,
  ): Promise<VideoCompletionResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const video = await this.findOwnedVideoForUpdate(
        manager,
        userId,
        videoId,
      );
      if (!video) {
        throw new VideoNotFoundException();
      }

      if (
        video.status === VideoStatus.PROCESSING ||
        video.status === VideoStatus.READY
      ) {
        return this.toResponse(video);
      }

      if (
        video.status !== VideoStatus.DRAFT ||
        video.multipart_upload_id === null ||
        video.multipart_upload_id !== dto.uploadId
      ) {
        throw new VideoUploadInvalidStateException();
      }

      const parts = this.normalizeParts(dto, Number(video.size_bytes));
      await this.storageService.completeMultipartUpload(
        video.source_storage_key,
        dto.uploadId,
        parts,
        Number(video.size_bytes),
      );

      const completedAt = new Date();
      video.status = VideoStatus.PROCESSING;
      video.multipart_upload_id = null;
      video.upload_completed_at = completedAt;
      await manager.save(video);

      const eventId = randomUUID();
      await manager.save(
        manager.create(OutboxEvent, {
          id: eventId,
          aggregate_type: VIDEO_PROCESSING_EVENT.AGGREGATE_TYPE,
          aggregate_id: video.id,
          event_type: VIDEO_PROCESSING_EVENT.EVENT_TYPE,
          payload: {
            schemaVersion: VIDEO_PROCESSING_EVENT.SCHEMA_VERSION,
            eventId,
            videoId: video.id,
            sourceStorageKey: video.source_storage_key,
            requestedAt: completedAt.toISOString(),
          },
        }),
      );

      return this.toResponse(video);
    });
  }

  private async findOwnedVideoForUpdate(
    manager: EntityManager,
    userId: string,
    videoId: string,
  ): Promise<Video | null> {
    return manager.findOne(Video, {
      where: { id: videoId, channel: { user_id: userId } },
      relations: { channel: true },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private normalizeParts(
    dto: CompleteVideoUploadDto,
    sizeBytes: number,
  ): Array<{ partNumber: number; eTag: string }> {
    const totalParts = Math.ceil(sizeBytes / VIDEO_UPLOAD.PART_SIZE_BYTES);
    if (
      dto.parts.length !== totalParts ||
      dto.parts.some(
        (part, index) =>
          part.partNumber !== index + 1 || part.eTag.trim().length === 0,
      )
    ) {
      throw new VideoUploadInvalidPartsException();
    }
    return dto.parts.map((part) => ({
      partNumber: part.partNumber,
      eTag: part.eTag.trim(),
    }));
  }

  private toResponse(video: Video): VideoCompletionResponseDto {
    return {
      id: video.id,
      publicId: video.public_id,
      status: video.status as VideoStatus.PROCESSING | VideoStatus.READY,
    };
  }
}
