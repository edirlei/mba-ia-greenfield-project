import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { VIDEO_UPLOAD } from '../video.constants';

export class UploadPartsDto {
  /** Multipart upload identity returned when the video was created. */
  @ApiProperty({ example: 'VXBsb2FkSWQtZXhhbXBsZQ', maxLength: 512 })
  @Transform(({ value }): unknown => {
    const input: unknown = value;
    return typeof input === 'string' ? input.trim() : input;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  uploadId: string;

  /** Unique multipart part numbers to sign. */
  @ApiProperty({
    type: [Number],
    example: [1, 2],
    minItems: 1,
    maxItems: VIDEO_UPLOAD.MAX_SIGNED_PARTS_PER_REQUEST,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(VIDEO_UPLOAD.MAX_SIGNED_PARTS_PER_REQUEST)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers: number[];
}
