import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  internalEndpoint:
    process.env.STORAGE_INTERNAL_ENDPOINT ?? 'http://minio:9000',
  publicEndpoint:
    process.env.STORAGE_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  bucket: process.env.STORAGE_BUCKET ?? 'streamtube',
  accessKey: process.env.STORAGE_ACCESS_KEY ?? '',
  secretKey: process.env.STORAGE_SECRET_KEY ?? '',
  uploadUrlTtlSeconds: parseInt(
    process.env.STORAGE_UPLOAD_URL_TTL_SECONDS ?? '900',
    10,
  ),
  readUrlTtlSeconds: parseInt(
    process.env.STORAGE_READ_URL_TTL_SECONDS ?? '300',
    10,
  ),
}));
