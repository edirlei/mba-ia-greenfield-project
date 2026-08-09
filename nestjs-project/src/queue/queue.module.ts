import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';
import { VIDEO_PROCESSING_QUEUE } from './queue.constants';

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        prefix: config.prefix,
        connection: {
          host: config.host,
          port: config.port,
          password: config.password,
          db: config.db,
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
