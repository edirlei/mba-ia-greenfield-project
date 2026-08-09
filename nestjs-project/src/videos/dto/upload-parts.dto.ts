import { Transform, Type } from 'class-transformer';
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
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  uploadId: string;

  /** Unique multipart part numbers to sign. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(VIDEO_UPLOAD.MAX_SIGNED_PARTS_PER_REQUEST)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers: number[];
}
