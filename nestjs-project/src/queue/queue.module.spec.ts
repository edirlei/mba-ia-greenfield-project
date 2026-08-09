import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import queueConfig from '../config/queue.config';
import { VIDEO_PROCESSING_QUEUE } from './queue.constants';
import { QueueModule } from './queue.module';

describe('QueueModule', () => {
  it('should compile with the registered video-processing queue', async () => {
    process.env.REDIS_HOST = 'redis';
    process.env.REDIS_PORT = '6379';

    const queue = { name: VIDEO_PROCESSING_QUEUE };
    const builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [queueConfig],
        }),
        QueueModule,
      ],
    });
    builder
      .overrideProvider(getQueueToken(VIDEO_PROCESSING_QUEUE))
      .useValue(queue);

    const module = await builder.compile();

    expect(module.get(getQueueToken(VIDEO_PROCESSING_QUEUE))).toBe(queue);
    await module.close();
  });
});
