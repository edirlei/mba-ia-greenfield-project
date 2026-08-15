import { Injectable } from '@nestjs/common';
import { VideoNotReadyException } from '../../common/exceptions/domain.exception';
import { S3StorageService } from '../../storage/s3-storage.service';
import { VideoStatus } from '../entities/video.entity';
import { VideoQueryService } from './video-query.service';

@Injectable()
export class VideoMediaAccessService {
  constructor(
    private readonly videoQueryService: VideoQueryService,
    private readonly storageService: S3StorageService,
  ) {}

  async getStreamUrl(userId: string, publicId: string): Promise<string> {
    const video = await this.videoQueryService.getOwnedVideo(userId, publicId);
    this.assertReady(video.status);
    return this.storageService.signReadUrl(video.source_storage_key, {
      disposition: 'inline',
    });
  }

  async getDownloadUrl(userId: string, publicId: string): Promise<string> {
    const video = await this.videoQueryService.getOwnedVideo(userId, publicId);
    this.assertReady(video.status);
    return this.storageService.signReadUrl(video.source_storage_key, {
      disposition: 'attachment',
      filename: this.sanitizeFilename(video.original_filename),
    });
  }

  async getThumbnailUrl(userId: string, publicId: string): Promise<string> {
    const video = await this.videoQueryService.getOwnedVideo(userId, publicId);
    if (
      video.status !== VideoStatus.READY ||
      video.thumbnail_storage_key === null
    ) {
      throw new VideoNotReadyException();
    }
    return this.storageService.signReadUrl(video.thumbnail_storage_key, {
      disposition: 'inline',
      contentType: 'image/jpeg',
    });
  }

  private assertReady(status: VideoStatus): void {
    if (status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }
  }

  private sanitizeFilename(value: string): string {
    const basename = value.replace(/\\/g, '/').split('/').pop() ?? '';
    const sanitized = basename
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9._ -]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    return sanitized || 'video';
  }
}
