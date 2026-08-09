import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from '../../config/database.config';
import { envValidationSchema } from '../../config/env.validation';
import queueConfig from '../../config/queue.config';
import storageConfig from '../../config/storage.config';
import videoProcessingConfig from '../../config/video-processing.config';
import { Channel } from '../../channels/entities/channel.entity';
import { QueueModule } from '../../queue/queue.module';
import { StorageModule } from '../../storage/storage.module';
import { User } from '../../users/entities/user.entity';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { Video } from '../entities/video.entity';
import { VideoMediaProcessor } from './video-media-processor.service';
import { VideoProcessingConsumer } from './video-processing.consumer';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, queueConfig, storageConfig, videoProcessingConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        database: config.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([User, Channel, Video, OutboxEvent]),
    StorageModule,
    QueueModule,
  ],
  providers: [VideoMediaProcessor, VideoProcessingConsumer],
  exports: [VideoMediaProcessor, VideoProcessingConsumer],
})
export class VideoWorkerModule {}
