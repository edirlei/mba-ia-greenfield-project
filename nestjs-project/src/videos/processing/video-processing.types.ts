import type { VideoMetadata } from '../entities/video.entity';

export interface VideoProcessingJobPayload {
  schemaVersion: 1;
  eventId: string;
  videoId: string;
  sourceStorageKey: string;
  requestedAt: string;
}

export interface ProcessedVideoMedia {
  durationSeconds: string;
  metadata: VideoMetadata;
  thumbnailStorageKey: string;
}
