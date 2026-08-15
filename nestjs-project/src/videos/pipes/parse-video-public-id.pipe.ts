import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

@Injectable()
export class ParseVideoPublicIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!PUBLIC_ID_PATTERN.test(value)) {
      throw new BadRequestException('publicId must be 22 Base64URL characters');
    }
    return value;
  }
}
