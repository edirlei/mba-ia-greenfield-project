import { envValidationSchema } from './env.validation';
import storageConfig from './storage.config';

const STORAGE_ENV_KEYS = [
  'STORAGE_INTERNAL_ENDPOINT',
  'STORAGE_PUBLIC_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
  'STORAGE_UPLOAD_URL_TTL_SECONDS',
  'STORAGE_READ_URL_TTL_SECONDS',
] as const;

const originalEnv = Object.fromEntries(
  STORAGE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

const requiredApplicationEnv = {
  DB_USERNAME: 'streamtube',
  DB_PASSWORD: 'streamtube',
  DB_NAME: 'streamtube',
  JWT_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
};

describe('storageConfig', () => {
  afterEach(() => {
    for (const key of STORAGE_ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('should expose separate internal and public endpoints with safe defaults', () => {
    for (const key of STORAGE_ENV_KEYS) delete process.env[key];
    process.env.STORAGE_ACCESS_KEY = 'streamtube';
    process.env.STORAGE_SECRET_KEY = 'streamtube-secret';

    const config = storageConfig();

    expect(config).toEqual({
      internalEndpoint: 'http://minio:9000',
      publicEndpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'streamtube',
      accessKey: 'streamtube',
      secretKey: 'streamtube-secret',
      uploadUrlTtlSeconds: 900,
      readUrlTtlSeconds: 300,
    });
  });

  it('should reject startup configuration without storage credentials', () => {
    const { error } = envValidationSchema.validate(requiredApplicationEnv, {
      allowUnknown: true,
      abortEarly: false,
    });

    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_BUCKET');
    expect(error!.message).toContain('STORAGE_ACCESS_KEY');
    expect(error!.message).toContain('STORAGE_SECRET_KEY');
  });

  it('should accept explicit endpoints, credentials and TTLs', () => {
    const { error, value } = envValidationSchema.validate(
      {
        ...requiredApplicationEnv,
        STORAGE_INTERNAL_ENDPOINT: 'http://minio:9000',
        STORAGE_PUBLIC_ENDPOINT: 'https://storage.example.com',
        STORAGE_BUCKET: 'videos',
        STORAGE_ACCESS_KEY: 'access-key',
        STORAGE_SECRET_KEY: 'secret-key',
        STORAGE_UPLOAD_URL_TTL_SECONDS: 1200,
        STORAGE_READ_URL_TTL_SECONDS: 600,
      },
      { allowUnknown: true, abortEarly: false },
    );

    expect(error).toBeUndefined();
    expect(value.STORAGE_UPLOAD_URL_TTL_SECONDS).toBe(1200);
    expect(value.STORAGE_READ_URL_TTL_SECONDS).toBe(600);
  });
});
