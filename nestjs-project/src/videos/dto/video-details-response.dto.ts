import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class VideoMetadataResponseDto {
  @ApiProperty({ example: 'mov,mp4,m4a,3gp,3g2,mj2' })
  formatName: string;

  @ApiProperty({ example: 'QuickTime / MOV' })
  formatLongName: string;

  @ApiProperty({ minimum: 0, example: 1_250_000 })
  bitRate: number;

  @ApiProperty({ example: 'h264' })
  videoCodec: string;

  @ApiProperty({ minimum: 1, example: 1920 })
  width: number;

  @ApiProperty({ minimum: 1, example: 1080 })
  height: number;

  @ApiProperty({ minimum: 0, example: 30 })
  frameRate: number;
}

export class VideoDetailsResponseDto {
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

  @ApiProperty({ example: 'Aula de arquitetura limpa' })
  title: string;

  @ApiProperty({ example: 'aula-arquitetura.mp4' })
  originalFilename: string;

  @ApiProperty({ example: 'video/mp4' })
  contentType: string;

  @ApiProperty({
    type: Number,
    format: 'int64',
    minimum: 1,
    example: 5_242_880,
  })
  sizeBytes: number;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.READY })
  status: VideoStatus;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    example: 12.345,
  })
  durationSeconds: number | null;

  @ApiPropertyOptional({
    type: VideoMetadataResponseDto,
    nullable: true,
  })
  metadata: VideoMetadataResponseDto | null;

  @ApiProperty({ example: true })
  thumbnailAvailable: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-08-09T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ format: 'date-time', example: '2026-08-09T12:01:00.000Z' })
  updatedAt: string;
}
