import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const trim = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim() : value;

const sanitizeBasename = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  return value.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
};

export class CreateVideoDto {
  /** Video title. */
  @Transform(({ value }) => trim(value))
  @IsString()
  @Length(1, 255)
  title: string;

  /** Original filename without any client-side path. */
  @Transform(({ value }) => sanitizeBasename(value))
  @IsString()
  @Length(1, 255)
  originalFilename: string;

  /** Source media type in the video family. */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(127)
  @Matches(/^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i)
  contentType: string;

  /** Declared source size in bytes. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes: number;
}
