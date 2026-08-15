import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({ example: 'Aula de arquitetura limpa', maxLength: 255 })
  @Transform(({ value }) => trim(value))
  @IsString()
  @Length(1, 255)
  title: string;

  /** Original filename without any client-side path. */
  @ApiProperty({ example: 'aula-arquitetura.mp4', maxLength: 255 })
  @Transform(({ value }) => sanitizeBasename(value))
  @IsString()
  @Length(1, 255)
  originalFilename: string;

  /** Source media type in the video family. */
  @ApiProperty({ example: 'video/mp4', maxLength: 127 })
  @Transform(({ value }): unknown => {
    const input: unknown = value;
    return typeof input === 'string' ? input.trim().toLowerCase() : input;
  })
  @IsString()
  @MaxLength(127)
  @Matches(/^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i)
  contentType: string;

  /** Declared source size in bytes. */
  @ApiProperty({ example: 5_242_880, minimum: 1, maximum: 10_737_418_240 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes: number;
}
