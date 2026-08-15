import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import storageConfig from '../../config/storage.config';
import videoProcessingConfig from '../../config/video-processing.config';
import { S3StorageService } from '../../storage/s3-storage.service';
import { INTERNAL_S3_CLIENT } from '../../storage/storage.constants';
import { StorageModule } from '../../storage/storage.module';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideoMediaProcessor } from './video-media-processor.service';

const execFileAsync = promisify(execFile);

describe('VideoMediaProcessor (integration)', () => {
  let moduleRef: TestingModule;
  let processor: VideoMediaProcessor;
  let storageService: S3StorageService;
  let s3: S3Client;
  let storage: ConfigType<typeof storageConfig>;
  let fixtureDir: string;
  let fixture: Buffer;
  const tempRoot = '/tmp/streamtube-media-processor-test';
  const keys = new Set<string>();

  beforeAll(async () => {
    process.env.VIDEO_PROCESSING_TEMP_DIR = tempRoot;
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videoProcessingConfig],
        }),
        StorageModule,
      ],
      providers: [VideoMediaProcessor],
    }).compile();
    processor = moduleRef.get(VideoMediaProcessor);
    storageService = moduleRef.get(S3StorageService);
    s3 = moduleRef.get(INTERNAL_S3_CLIENT);
    storage = moduleRef.get(storageConfig.KEY);

    fixtureDir = await mkdtemp(join(tmpdir(), 'streamtube-ffmpeg-fixture-'));
    const fixturePath = join(fixtureDir, 'fixture.mp4');
    await execFileAsync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=25',
      '-t',
      '1.2',
      '-c:v',
      'mpeg4',
      '-q:v',
      '5',
      '-pix_fmt',
      'yuv420p',
      '-y',
      fixturePath,
    ]);
    fixture = await readFile(fixturePath);
  });

  beforeEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    for (const key of keys) {
      await s3.send(
        new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }),
      );
    }
    keys.clear();
  });

  afterAll(async () => {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
    await moduleRef.close();
  });

  function video(id: string): Video {
    return Object.assign(new Video(), {
      id,
      status: VideoStatus.PROCESSING,
      source_storage_key: `videos/${id}/source`,
    });
  }

  it('extracts normalized metadata and uploads a bounded JPEG thumbnail', async () => {
    const item = video('61c52e29-cf59-4176-b72c-1d560fb18dc1');
    const thumbnailKey = `videos/${item.id}/thumbnails/default.jpg`;
    keys.add(item.source_storage_key);
    keys.add(thumbnailKey);
    await storageService.putObject(
      item.source_storage_key,
      fixture,
      'video/mp4',
    );

    const result = await processor.process(item);

    expect(Number(result.durationSeconds)).toBeCloseTo(1.2, 1);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        videoCodec: 'mpeg4',
        width: 320,
        height: 240,
        frameRate: 25,
      }),
    );
    expect(result.thumbnailStorageKey).toBe(thumbnailKey);
    const thumbnail = await s3.send(
      new HeadObjectCommand({ Bucket: storage.bucket, Key: thumbnailKey }),
    );
    expect(thumbnail.ContentType).toBe('image/jpeg');
    expect(thumbnail.ContentLength).toBeGreaterThan(0);
    await expect(readdir(tempRoot)).resolves.toHaveLength(0);
  });

  it('removes temporary files after ffprobe rejects an invalid source', async () => {
    const item = video('01c47525-b7ed-4d64-91ae-f42890e6cf77');
    keys.add(item.source_storage_key);
    await storageService.putObject(
      item.source_storage_key,
      Buffer.from('not-a-video'),
      'video/mp4',
    );

    await expect(processor.process(item)).rejects.toThrow();

    await expect(readdir(tempRoot)).resolves.toHaveLength(0);
  });
});
