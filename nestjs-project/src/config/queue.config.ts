import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  host: process.env.REDIS_HOST ?? 'redis',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB ?? '0', 10),
  prefix: process.env.REDIS_PREFIX ?? 'streamtube',
}));
