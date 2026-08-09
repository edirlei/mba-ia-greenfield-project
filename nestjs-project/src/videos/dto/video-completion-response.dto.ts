import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class VideoCompletionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ minLength: 22, maxLength: 22 })
  publicId: string;

  @ApiProperty({
    enum: [VideoStatus.PROCESSING, VideoStatus.READY],
    example: VideoStatus.PROCESSING,
  })
  status: VideoStatus.PROCESSING | VideoStatus.READY;
}
