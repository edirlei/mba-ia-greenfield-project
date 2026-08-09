import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VIDEO_UPLOAD } from '../video.constants';

export class CompleteVideoPartDto {
  /** Multipart part number. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  partNumber: number;

  /** ETag returned by object storage when the part was uploaded. */
  @Transform(({ value }): unknown => {
    const input: unknown = value;
    return typeof input === 'string' ? input.trim() : input;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  eTag: string;
}

export class CompleteVideoUploadDto {
  /** Multipart upload identity returned when the video was created. */
  @Transform(({ value }): unknown => {
    const input: unknown = value;
    return typeof input === 'string' ? input.trim() : input;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  uploadId: string;

  /** All uploaded parts in strictly ascending order. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(VIDEO_UPLOAD.MAX_PARTS)
  @ValidateNested({ each: true })
  @Type(() => CompleteVideoPartDto)
  parts: CompleteVideoPartDto[];
}
