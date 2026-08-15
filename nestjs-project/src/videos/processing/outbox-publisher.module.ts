import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueModule } from '../../queue/queue.module';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { OutboxPublisherService } from './outbox-publisher.service';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent]), QueueModule],
  providers: [OutboxPublisherService],
  exports: [OutboxPublisherService],
})
export class OutboxPublisherModule {}
