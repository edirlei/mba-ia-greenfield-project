import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { UploadPartsDto } from './dto/upload-parts.dto';
import {
  UploadPartsResponseDto,
  VideoUploadResponseDto,
} from './dto/video-upload-response.dto';
import { VideoUploadService } from './services/video-upload.service';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(private readonly videoUploadService: VideoUploadService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a multipart video upload',
    description:
      'Creates a draft video and starts a multipart upload without routing video bytes through the API.',
  })
  @ApiResponse({
    status: 201,
    description: 'Multipart upload created',
    type: VideoUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description: 'Video exceeds the upload size limit',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage is unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async createUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<VideoUploadResponseDto> {
    return this.videoUploadService.createUpload(user.sub, dto);
  }

  @Post(':id/upload-parts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign multipart upload parts',
    description:
      'Issues or renews public pre-signed URLs for selected parts of a draft video upload.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Video upload ID' })
  @ApiResponse({
    status: 200,
    description: 'Upload part URLs issued',
    type: UploadPartsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or part numbers are invalid',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found for the authenticated channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video status or upload identity is invalid',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage is unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async signUploadParts(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) videoId: string,
    @Body() dto: UploadPartsDto,
  ): Promise<UploadPartsResponseDto> {
    return this.videoUploadService.signUploadParts(user.sub, videoId, dto);
  }
}
