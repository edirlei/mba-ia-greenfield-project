import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Job } from 'bullmq';
import { DataSource, type EntityManager } from 'typeorm';
import videoProcessingConfig from '../../config/video-processing.config';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../../queue/queue.constants';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideoMediaProcessor } from './video-media-processor.service';
import type {
  ProcessedVideoMedia,
  VideoProcessingJobPayload,
} from './video-processing.types';

@Injectable()
@Processor(VIDEO_PROCESSING_QUEUE, { concurrency: 1 })
export class VideoProcessingConsumer
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly dataSource: DataSource,
    private readonly mediaProcessor: VideoMediaProcessor,
    @Inject(videoProcessingConfig.KEY)
    private readonly config: ConfigType<typeof videoProcessingConfig>,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.concurrency;
  }

  async process(job: Job<VideoProcessingJobPayload>): Promise<void> {
    if (job.name !== VIDEO_PROCESSING_JOB) {
      throw new Error(`Unsupported video processing job: ${job.name}`);
    }

    const video = await this.claimVideo(job.data.videoId);
    if (!video) return;

    try {
      const media = await this.mediaProcessor.process(video);
      await this.markReady(video.id, media);
    } catch (error) {
      if (this.isFinalAttempt(job)) {
        await this.markError(video.id, error);
      }
      throw error;
    }
  }

  private async claimVideo(videoId: string): Promise<Video | null> {
    return this.dataSource.transaction(async (manager) => {
      const video = await this.findForUpdate(manager, videoId);
      if (!video || video.status !== VideoStatus.PROCESSING) return null;
      if (!video.processing_started_at) {
        video.processing_started_at = new Date();
        await manager.save(video);
      }
      return video;
    });
  }

  private async markReady(
    videoId: string,
    media: ProcessedVideoMedia,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const video = await this.findForUpdate(manager, videoId);
      if (!video || video.status === VideoStatus.READY) return;
      if (video.status !== VideoStatus.PROCESSING) return;

      video.duration_seconds = media.durationSeconds;
      video.metadata = media.metadata;
      video.thumbnail_storage_key = media.thumbnailStorageKey;
      video.processed_at = new Date();
      video.processing_error = null;
      video.status = VideoStatus.READY;
      await manager.save(video);
    });
  }

  private async markError(videoId: string, error: unknown): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const video = await this.findForUpdate(manager, videoId);
      if (!video || video.status !== VideoStatus.PROCESSING) return;
      video.status = VideoStatus.ERROR;
      video.processing_error = this.errorMessage(error).slice(0, 4000);
      await manager.save(video);
    });
  }

  private findForUpdate(
    manager: EntityManager,
    videoId: string,
  ): Promise<Video | null> {
    return manager.findOne(Video, {
      where: { id: videoId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private isFinalAttempt(job: Job<VideoProcessingJobPayload>): boolean {
    const attempts = job.opts.attempts ?? this.config.attempts;
    return job.attemptsMade + 1 >= attempts;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
