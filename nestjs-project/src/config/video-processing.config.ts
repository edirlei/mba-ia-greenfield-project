import { registerAs } from '@nestjs/config';

export default registerAs('videoProcessing', () => ({
  concurrency: parseInt(process.env.VIDEO_PROCESSING_CONCURRENCY ?? '1', 10),
  attempts: parseInt(process.env.VIDEO_PROCESSING_ATTEMPTS ?? '5', 10),
  backoffMs: parseInt(process.env.VIDEO_PROCESSING_BACKOFF_MS ?? '5000', 10),
  tempDir: process.env.VIDEO_PROCESSING_TEMP_DIR ?? '/tmp/streamtube-videos',
  outboxPollIntervalMs: parseInt(
    process.env.OUTBOX_POLL_INTERVAL_MS ?? '1000',
    10,
  ),
  outboxBatchSize: parseInt(process.env.OUTBOX_BATCH_SIZE ?? '25', 10),
}));
