import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class VideoUploadResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '8f184c66-e3d9-4d3d-a2e6-5abc1d39fb7d',
  })
  id: string;

  @ApiProperty({
    minLength: 22,
    maxLength: 22,
    example: 'A1b2C3d4E5f6G7h8I9j0KQ',
  })
  publicId: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.DRAFT })
  status: VideoStatus;

  @ApiProperty({ example: 'VXBsb2FkSWQtZXhhbXBsZQ' })
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

  @ApiProperty({
    format: 'uri',
    example: 'http://localhost:9000/streamtube/videos/id/source?X-Amz-...',
  })
  url: string;
}

export class UploadPartsResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '8f184c66-e3d9-4d3d-a2e6-5abc1d39fb7d',
  })
  videoId: string;

  @ApiProperty({ example: 'VXBsb2FkSWQtZXhhbXBsZQ' })
  uploadId: string;

  @ApiProperty({ format: 'date-time', example: '2026-08-09T12:15:00.000Z' })
  expiresAt: string;

  @ApiProperty({ type: () => [UploadPartUrlDto] })
  parts: UploadPartUrlDto[];
}
