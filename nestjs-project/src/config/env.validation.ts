import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  STORAGE_INTERNAL_ENDPOINT: Joi.string().uri().default('http://minio:9000'),
  STORAGE_PUBLIC_ENDPOINT: Joi.string().uri().default('http://localhost:9000'),
  STORAGE_REGION: Joi.string().default('us-east-1'),
  STORAGE_BUCKET: Joi.string().min(3).required(),
  STORAGE_ACCESS_KEY: Joi.string().min(3).required(),
  STORAGE_SECRET_KEY: Joi.string().min(8).required(),
  STORAGE_UPLOAD_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(604800)
    .default(900),
  STORAGE_READ_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(604800)
    .default(300),
  REDIS_HOST: Joi.string().default('redis'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().integer().min(0).max(15).default(0),
  REDIS_PREFIX: Joi.string().default('streamtube'),
  VIDEO_PROCESSING_CONCURRENCY: Joi.number()
    .integer()
    .min(1)
    .max(32)
    .default(1),
  VIDEO_PROCESSING_ATTEMPTS: Joi.number().integer().min(1).max(10).default(5),
  VIDEO_PROCESSING_BACKOFF_MS: Joi.number()
    .integer()
    .min(100)
    .max(600000)
    .default(5000),
  VIDEO_PROCESSING_TEMP_DIR: Joi.string().default('/tmp/streamtube-videos'),
  OUTBOX_POLL_INTERVAL_MS: Joi.number()
    .integer()
    .min(100)
    .max(60000)
    .default(1000),
  OUTBOX_BATCH_SIZE: Joi.number().integer().min(1).max(1000).default(25),
});
