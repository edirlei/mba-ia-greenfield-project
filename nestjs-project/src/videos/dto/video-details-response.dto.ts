import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class VideoMetadataResponseDto {
  @ApiProperty()
  formatName: string;

  @ApiProperty()
  formatLongName: string;

  @ApiProperty({ minimum: 0 })
  bitRate: number;

  @ApiProperty()
  videoCodec: string;

  @ApiProperty({ minimum: 1 })
  width: number;

  @ApiProperty({ minimum: 1 })
  height: number;

  @ApiProperty({ minimum: 0 })
  frameRate: number;
}

export class VideoDetailsResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ minLength: 22, maxLength: 22 })
  publicId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  originalFilename: string;

  @ApiProperty({ example: 'video/mp4' })
  contentType: string;

  @ApiProperty({ type: Number, format: 'int64', minimum: 1 })
  sizeBytes: number;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0 })
  durationSeconds: number | null;

  @ApiPropertyOptional({
    type: VideoMetadataResponseDto,
    nullable: true,
  })
  metadata: VideoMetadataResponseDto | null;

  @ApiProperty()
  thumbnailAvailable: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}
