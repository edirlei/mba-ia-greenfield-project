import { DataSource, EntitySchema, MigrationInterface } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { OutboxEvent } from '../videos/entities/outbox-event.entity';
import { Video } from '../videos/entities/video.entity';

interface TestDataSourceOptions {
  synchronize?: boolean;
  migrations?: (new () => MigrationInterface)[];
}

export function createTestDataSource(
  entities: (Function | string | EntitySchema<any>)[],
  options: TestDataSourceOptions = {},
): DataSource {
  const { synchronize = true, migrations } = options;
  const completeEntities = entities.includes(Channel)
    ? [...new Set([...entities, Video, OutboxEvent])]
    : entities;

  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'db',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'streamtube',
    password: process.env.DB_PASSWORD ?? 'streamtube',
    database: process.env.DB_DATABASE ?? 'streamtube',
    entities: completeEntities,
    synchronize,
    ...(migrations !== undefined && { migrations, migrationsRun: false }),
  });
}

export async function cleanAllTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM "refresh_tokens"');
  await dataSource.query('DELETE FROM "verification_tokens"');
  await dataSource.query('DELETE FROM "channels"');
  await dataSource.query('DELETE FROM "users"');
}

export async function cleanVideoTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM "outbox_events"');
  await dataSource.query('DELETE FROM "videos"');
}
