import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { StorageModule } from '../storage/storage.module';
import { OutboxEvent } from './entities/outbox-event.entity';
import { Video } from './entities/video.entity';
import { VideoUploadService } from './services/video-upload.service';
import { VideosController } from './videos.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, OutboxEvent, Channel]),
    StorageModule,
  ],
  controllers: [VideosController],
  providers: [VideoUploadService],
  exports: [TypeOrmModule, VideoUploadService],
})
export class VideosModule {}
