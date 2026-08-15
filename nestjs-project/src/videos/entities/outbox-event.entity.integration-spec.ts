import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  cleanVideoTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { OutboxEvent } from './outbox-event.entity';
import { Video } from './video.entity';

const ALL_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
  OutboxEvent,
];

describe('OutboxEvent entity (integration)', () => {
  let dataSource: DataSource;
  let repository: Repository<OutboxEvent>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    repository = dataSource.getRepository(OutboxEvent);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanVideoTables(dataSource);
    await cleanAllTables(dataSource);
  });

  it('persists unpublished defaults and JSON payload', async () => {
    const aggregateId = randomUUID();
    const saved = await repository.save(
      repository.create({
        aggregate_type: 'video',
        aggregate_id: aggregateId,
        event_type: 'video.processing.requested.v1',
        payload: { schemaVersion: 1, videoId: aggregateId },
      }),
    );

    expect(saved.attempts).toBe(0);
    expect(saved.next_attempt_at).toBeInstanceOf(Date);
    expect(saved.published_at).toBeNull();
    expect(saved.last_error).toBeNull();
    expect(saved.payload).toEqual({ schemaVersion: 1, videoId: aggregateId });
    expect(saved.created_at).toBeInstanceOf(Date);
  });

  it('creates aggregate and partial unpublished indexes', async () => {
    const rows = await dataSource.query<
      { indexname: string; indexdef: string }[]
    >(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'outbox_events'`,
    );
    const definitions = rows.map((row) => row.indexdef).join('\n');

    expect(definitions).toContain('(aggregate_type, aggregate_id)');
    expect(definitions).toContain('(next_attempt_at, created_at)');
    expect(definitions).toContain('WHERE (published_at IS NULL)');
  });
});
