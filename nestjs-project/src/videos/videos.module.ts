import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { StorageModule } from '../storage/storage.module';
import { OutboxEvent } from './entities/outbox-event.entity';
import { Video } from './entities/video.entity';
import { VideoUploadService } from './services/video-upload.service';
import { VideoCompletionService } from './services/video-completion.service';
import { VideoMediaAccessService } from './services/video-media-access.service';
import { VideoQueryService } from './services/video-query.service';
import { VideosController } from './videos.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, OutboxEvent, Channel]),
    StorageModule,
  ],
  controllers: [VideosController],
  providers: [
    VideoCompletionService,
    VideoMediaAccessService,
    VideoQueryService,
    VideoUploadService,
  ],
  exports: [
    TypeOrmModule,
    VideoCompletionService,
    VideoMediaAccessService,
    VideoQueryService,
    VideoUploadService,
  ],
})
export class VideosModule {}
