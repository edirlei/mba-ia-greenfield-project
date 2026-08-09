import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class VideoUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    minLength: 22,
    maxLength: 22,
    example: 'A1b2C3d4E5f6G7h8I9j0KQ',
  })
  publicId: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.DRAFT })
  status: VideoStatus;

  @ApiProperty()
  uploadId: string;

  @ApiProperty({ example: 67_108_864 })
  partSizeBytes: number;

  @ApiProperty({ example: 160 })
  totalParts: number;

  @ApiProperty({ example: 900 })
  uploadPartUrlTtlSeconds: number;
}

export class UploadPartUrlDto {
  @ApiProperty({ minimum: 1, example: 1 })
  partNumber: number;

  @ApiProperty({ format: 'uri' })
  url: string;
}

export class UploadPartsResponseDto {
  @ApiProperty({ format: 'uuid' })
  videoId: string;

  @ApiProperty()
  uploadId: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;

  @ApiProperty({ type: () => [UploadPartUrlDto] })
  parts: UploadPartUrlDto[];
}
