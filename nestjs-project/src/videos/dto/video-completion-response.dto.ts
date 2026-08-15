import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class VideoCompletionResponseDto {
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

  @ApiProperty({
    enum: [VideoStatus.PROCESSING, VideoStatus.READY],
    example: VideoStatus.PROCESSING,
  })
  status: VideoStatus.PROCESSING | VideoStatus.READY;
}
