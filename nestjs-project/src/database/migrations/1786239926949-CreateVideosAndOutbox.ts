import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideosAndOutbox1786239926949 implements MigrationInterface {
  name = 'CreateVideosAndOutbox1786239926949';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."video_status" AS ENUM('DRAFT', 'PROCESSING', 'READY', 'ERROR')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "public_id" character varying(22) NOT NULL, "title" character varying(255) NOT NULL, "original_filename" character varying(255) NOT NULL, "content_type" character varying(127) NOT NULL, "size_bytes" bigint NOT NULL, "status" "public"."video_status" NOT NULL DEFAULT 'DRAFT', "source_storage_key" character varying(512) NOT NULL, "thumbnail_storage_key" character varying(512), "multipart_upload_id" character varying(512), "duration_seconds" numeric(12,3), "metadata" jsonb, "upload_completed_at" TIMESTAMP WITH TIME ZONE, "processing_started_at" TIMESTAMP WITH TIME ZONE, "processed_at" TIMESTAMP WITH TIME ZONE, "processing_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_39a1f0fe7991162aace659078ec" UNIQUE ("public_id"), CONSTRAINT "UQ_1a43754033d19b60611bc73a705" UNIQUE ("source_storage_key"), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_videos_thumbnail_storage_key" ON "videos" ("thumbnail_storage_key") WHERE "thumbnail_storage_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_created_at" ON "videos" ("channel_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status" ON "videos" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_id" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "outbox_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "aggregate_type" character varying(50) NOT NULL, "aggregate_id" uuid NOT NULL, "event_type" character varying(100) NOT NULL, "payload" jsonb NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6689a16c00d09b8089f6237f1d2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_events_aggregate" ON "outbox_events" ("aggregate_type", "aggregate_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_events_unpublished" ON "outbox_events" ("next_attempt_at", "created_at") WHERE "published_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_outbox_events_unpublished"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_outbox_events_aggregate"`,
    );
    await queryRunner.query(`DROP TABLE "outbox_events"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_videos_channel_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_videos_thumbnail_storage_key"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."video_status"`);
  }
}
