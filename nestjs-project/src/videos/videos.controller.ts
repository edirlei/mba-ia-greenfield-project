import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Redirect,
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
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';
import { UploadPartsDto } from './dto/upload-parts.dto';
import {
  UploadPartsResponseDto,
  VideoUploadResponseDto,
} from './dto/video-upload-response.dto';
import { VideoUploadService } from './services/video-upload.service';
import { VideoCompletionService } from './services/video-completion.service';
import { VideoCompletionResponseDto } from './dto/video-completion-response.dto';
import { VideoDetailsResponseDto } from './dto/video-details-response.dto';
import { ParseVideoPublicIdPipe } from './pipes/parse-video-public-id.pipe';
import { VideoMediaAccessService } from './services/video-media-access.service';
import { VideoQueryService } from './services/video-query.service';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videoUploadService: VideoUploadService,
    private readonly videoCompletionService: VideoCompletionService,
    private readonly videoQueryService: VideoQueryService,
    private readonly videoMediaAccessService: VideoMediaAccessService,
  ) {}

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

  @Post(':id/upload-completion')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Complete a multipart video upload',
    description:
      'Completes and verifies the source object, then atomically transitions the video to processing and records an outbox command.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Video upload ID' })
  @ApiResponse({
    status: 202,
    description: 'Upload completed or already processing',
    type: VideoCompletionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Multipart parts are invalid',
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
    status: 422,
    description: 'Completed object is missing or has an unexpected size',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage is unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) videoId: string,
    @Body() dto: CompleteVideoUploadDto,
  ): Promise<VideoCompletionResponseDto> {
    return this.videoCompletionService.completeUpload(user.sub, videoId, dto);
  }

  @Get(':publicId/stream')
  @Redirect(undefined, HttpStatus.TEMPORARY_REDIRECT)
  @ApiOperation({
    summary: 'Stream a ready video',
    description:
      'Authorizes the owner and redirects to private storage. Range is preserved by the client after the temporary redirect.',
  })
  @ApiParam({
    name: 'publicId',
    schema: {
      type: 'string',
      minLength: 22,
      maxLength: 22,
      pattern: '^[A-Za-z0-9_-]{22}$',
    },
  })
  @ApiResponse({
    status: 307,
    description: 'Temporary redirect to an inline signed source URL',
    headers: {
      Location: {
        description: 'Public pre-signed storage URL',
        schema: { type: 'string', format: 'uri' },
      },
    },
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
    description: 'Video is not ready for media access',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage is unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @CurrentUser() user: JwtPayload,
    @Param('publicId', ParseVideoPublicIdPipe) publicId: string,
  ): Promise<{ url: string; statusCode: number }> {
    return this.redirect(
      await this.videoMediaAccessService.getStreamUrl(user.sub, publicId),
    );
  }

  @Get(':publicId/download')
  @Redirect(undefined, HttpStatus.TEMPORARY_REDIRECT)
  @ApiOperation({
    summary: 'Download a ready video',
    description:
      'Authorizes the owner and redirects to the private source object with attachment disposition.',
  })
  @ApiParam({
    name: 'publicId',
    schema: {
      type: 'string',
      minLength: 22,
      maxLength: 22,
      pattern: '^[A-Za-z0-9_-]{22}$',
    },
  })
  @ApiResponse({
    status: 307,
    description: 'Temporary redirect to an attachment signed source URL',
    headers: {
      Location: {
        description: 'Public pre-signed storage URL',
        schema: { type: 'string', format: 'uri' },
      },
    },
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
    description: 'Video is not ready for media access',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage is unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @CurrentUser() user: JwtPayload,
    @Param('publicId', ParseVideoPublicIdPipe) publicId: string,
  ): Promise<{ url: string; statusCode: number }> {
    return this.redirect(
      await this.videoMediaAccessService.getDownloadUrl(user.sub, publicId),
    );
  }

  @Get(':publicId/thumbnail')
  @Redirect(undefined, HttpStatus.TEMPORARY_REDIRECT)
  @ApiOperation({
    summary: 'Get a ready video thumbnail',
    description:
      'Authorizes the owner and redirects to the private JPEG thumbnail.',
  })
  @ApiParam({
    name: 'publicId',
    schema: {
      type: 'string',
      minLength: 22,
      maxLength: 22,
      pattern: '^[A-Za-z0-9_-]{22}$',
    },
  })
  @ApiResponse({
    status: 307,
    description: 'Temporary redirect to an inline signed thumbnail URL',
    headers: {
      Location: {
        description: 'Public pre-signed storage URL',
        schema: { type: 'string', format: 'uri' },
      },
    },
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
    description: 'Video or thumbnail is not ready for media access',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage is unavailable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async thumbnail(
    @CurrentUser() user: JwtPayload,
    @Param('publicId', ParseVideoPublicIdPipe) publicId: string,
  ): Promise<{ url: string; statusCode: number }> {
    return this.redirect(
      await this.videoMediaAccessService.getThumbnailUrl(user.sub, publicId),
    );
  }

  @Get(':publicId')
  @ApiOperation({ summary: 'Get owned video processing details' })
  @ApiParam({
    name: 'publicId',
    schema: {
      type: 'string',
      minLength: 22,
      maxLength: 22,
      pattern: '^[A-Za-z0-9_-]{22}$',
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Safe video processing details',
    type: VideoDetailsResponseDto,
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
  async details(
    @CurrentUser() user: JwtPayload,
    @Param('publicId', ParseVideoPublicIdPipe) publicId: string,
  ): Promise<VideoDetailsResponseDto> {
    return this.videoQueryService.getDetails(user.sub, publicId);
  }

  private redirect(url: string): { url: string; statusCode: number } {
    return { url, statusCode: HttpStatus.TEMPORARY_REDIRECT };
  }
}
