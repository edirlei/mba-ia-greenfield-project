import { envValidationSchema } from './env.validation';
import queueConfig from './queue.config';
import videoProcessingConfig from './video-processing.config';

const CONFIG_ENV_KEYS = [
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_DB',
  'REDIS_PREFIX',
  'VIDEO_PROCESSING_CONCURRENCY',
  'VIDEO_PROCESSING_ATTEMPTS',
  'VIDEO_PROCESSING_BACKOFF_MS',
  'VIDEO_PROCESSING_TEMP_DIR',
  'OUTBOX_POLL_INTERVAL_MS',
  'OUTBOX_BATCH_SIZE',
] as const;

const originalEnv = Object.fromEntries(
  CONFIG_ENV_KEYS.map((key) => [key, process.env[key]]),
);

describe('queueConfig and videoProcessingConfig', () => {
  afterEach(() => {
    for (const key of CONFIG_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('should use the Compose service and safe worker defaults', () => {
    for (const key of CONFIG_ENV_KEYS) delete process.env[key];

    expect(queueConfig()).toEqual({
      host: 'redis',
      port: 6379,
      password: undefined,
      db: 0,
      prefix: 'streamtube',
    });
    expect(videoProcessingConfig()).toEqual({
      concurrency: 1,
      attempts: 5,
      backoffMs: 5000,
      tempDir: '/tmp/streamtube-videos',
      outboxPollIntervalMs: 1000,
      outboxBatchSize: 25,
    });
  });

  it('should reject invalid Redis and worker numeric bounds', () => {
    const { error } = envValidationSchema.validate(
      {
        DB_USERNAME: 'streamtube',
        DB_PASSWORD: 'streamtube',
        DB_NAME: 'streamtube',
        JWT_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        STORAGE_BUCKET: 'videos',
        STORAGE_ACCESS_KEY: 'access-key',
        STORAGE_SECRET_KEY: 'secret-key',
        REDIS_PORT: 70000,
        REDIS_DB: 16,
        VIDEO_PROCESSING_CONCURRENCY: 0,
        VIDEO_PROCESSING_ATTEMPTS: 11,
        VIDEO_PROCESSING_BACKOFF_MS: 99,
        OUTBOX_POLL_INTERVAL_MS: 99,
        OUTBOX_BATCH_SIZE: 0,
      },
      { allowUnknown: true, abortEarly: false },
    );

    expect(error).toBeDefined();
    for (const key of [
      'REDIS_PORT',
      'REDIS_DB',
      'VIDEO_PROCESSING_CONCURRENCY',
      'VIDEO_PROCESSING_ATTEMPTS',
      'VIDEO_PROCESSING_BACKOFF_MS',
      'OUTBOX_POLL_INTERVAL_MS',
      'OUTBOX_BATCH_SIZE',
    ]) {
      expect(error!.message).toContain(key);
    }
  });
});
