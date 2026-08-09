import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { VideoNotFoundException } from '../../common/exceptions/domain.exception';
import type { VideoDetailsResponseDto } from '../dto/video-details-response.dto';
import { Video } from '../entities/video.entity';

@Injectable()
export class VideoQueryService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
  ) {}

  async getDetails(
    userId: string,
    publicId: string,
  ): Promise<VideoDetailsResponseDto> {
    return this.toDetails(await this.getOwnedVideo(userId, publicId));
  }

  async getOwnedVideo(userId: string, publicId: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId, channel: { user_id: userId } },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  private toDetails(video: Video): VideoDetailsResponseDto {
    return {
      id: video.id,
      publicId: video.public_id,
      title: video.title,
      originalFilename: video.original_filename,
      contentType: video.content_type,
      sizeBytes: Number(video.size_bytes),
      status: video.status,
      durationSeconds:
        video.duration_seconds === null ? null : Number(video.duration_seconds),
      metadata: video.metadata,
      thumbnailAvailable: video.thumbnail_storage_key !== null,
      createdAt: video.created_at.toISOString(),
      updatedAt: video.updated_at.toISOString(),
    };
  }
}
