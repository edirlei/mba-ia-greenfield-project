import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videoProcessingConfig from '../../config/video-processing.config';
import { S3StorageService } from '../../storage/s3-storage.service';
import type { Video, VideoMetadata } from '../entities/video.entity';
import type { ProcessedVideoMedia } from './video-processing.types';

const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;

@Injectable()
export class VideoMediaProcessor {
  constructor(
    private readonly storage: S3StorageService,
    @Inject(videoProcessingConfig.KEY)
    private readonly config: ConfigType<typeof videoProcessingConfig>,
  ) {}

  async process(video: Video): Promise<ProcessedVideoMedia> {
    const root = this.config.tempDir || join(tmpdir(), 'streamtube-videos');
    await mkdir(root, { recursive: true });
    const workDir = await mkdtemp(join(root, `${video.id}-`));
    const sourcePath = join(workDir, 'source');
    const thumbnailPath = join(workDir, 'thumbnail.jpg');
    const thumbnailStorageKey = `videos/${video.id}/thumbnails/default.jpg`;

    try {
      await pipeline(
        await this.storage.getObjectStream(video.source_storage_key),
        createWriteStream(sourcePath),
      );
      const probe = await this.probe(sourcePath);
      await this.createThumbnail(
        sourcePath,
        thumbnailPath,
        probe.durationSeconds,
      );
      await this.storage.putObject(
        thumbnailStorageKey,
        await readFile(thumbnailPath),
        'image/jpeg',
      );
      return {
        durationSeconds: probe.durationSeconds.toFixed(3),
        metadata: probe.metadata,
        thumbnailStorageKey,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async probe(
    sourcePath: string,
  ): Promise<{ durationSeconds: number; metadata: VideoMetadata }> {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=format_name,format_long_name,bit_rate,duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration',
        '-of',
        'json',
        sourcePath,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    const parsed: unknown = JSON.parse(stdout);
    const root = this.object(parsed, 'ffprobe output');
    const format = this.object(root.format, 'ffprobe format');
    const streams = root.streams;
    if (!Array.isArray(streams)) {
      throw new Error('ffprobe did not return streams');
    }
    const videoStream = streams
      .map((stream) => this.object(stream, 'ffprobe stream'))
      .find((stream) => stream.codec_type === 'video');
    if (!videoStream) {
      throw new Error('ffprobe did not find a video stream');
    }

    const durationSeconds = this.number(
      format.duration ?? videoStream.duration,
      'duration',
    );
    if (durationSeconds < 0) {
      throw new Error('ffprobe returned a negative duration');
    }

    return {
      durationSeconds,
      metadata: {
        formatName: this.string(format.format_name),
        formatLongName: this.string(format.format_long_name),
        bitRate: this.number(format.bit_rate, 'bit rate', 0),
        videoCodec: this.string(videoStream.codec_name, 'unknown'),
        width: this.number(videoStream.width, 'width'),
        height: this.number(videoStream.height, 'height'),
        frameRate: this.frameRate(
          this.string(
            videoStream.avg_frame_rate ?? videoStream.r_frame_rate,
            '0/1',
          ),
        ),
      },
    };
  }

  private async createThumbnail(
    sourcePath: string,
    thumbnailPath: string,
    durationSeconds: number,
  ): Promise<void> {
    const timestamp =
      durationSeconds < 1 ? 0 : Math.min(durationSeconds * 0.1, 30);
    await execFileAsync('ffmpeg', [
      '-v',
      'error',
      '-ss',
      timestamp.toFixed(3),
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-vf',
      "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease",
      '-q:v',
      '2',
      '-y',
      thumbnailPath,
    ]);
  }

  private object(value: unknown, label: string): JsonObject {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`Invalid ${label}`);
    }
    return value as JsonObject;
  }

  private string(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
  }

  private number(value: unknown, label: string, fallback?: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      if (fallback !== undefined) return fallback;
      throw new Error(`Invalid ffprobe ${label}`);
    }
    return parsed;
  }

  private frameRate(value: string): number {
    const [numerator, denominator = '1'] = value.split('/');
    const result = Number(numerator) / Number(denominator);
    return Number.isFinite(result) ? result : 0;
  }
}
