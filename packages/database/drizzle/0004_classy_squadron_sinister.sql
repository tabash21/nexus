CREATE TABLE "ingest"."archive_links" (
	"stream_id" text NOT NULL,
	"topic" text NOT NULL,
	"partition" integer NOT NULL,
	"offset_value" bigint NOT NULL,
	"object_key" text NOT NULL,
	"version_id" text NOT NULL,
	"record_position" integer NOT NULL,
	"raw_sha256" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_links_pk" PRIMARY KEY("stream_id","topic","partition","offset_value"),
	CONSTRAINT "archive_position_nonnegative" CHECK (record_position >= 0)
);
--> statement-breakpoint
CREATE TABLE "ingest"."enrichment_jobs" (
	"job_id" bigserial PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"content_revision" bigint NOT NULL,
	"event_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"processor_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"claim_token" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_identity" UNIQUE("item_id","content_revision","job_type","processor_version"),
	CONSTRAINT "job_revision_positive" CHECK (content_revision > 0),
	CONSTRAINT "job_attempts_valid" CHECK (attempts >= 0 AND max_attempts > 0),
	CONSTRAINT "job_status_valid" CHECK (status IN ('pending','running','succeeded','failed','stale'))
);
--> statement-breakpoint
CREATE TABLE "ingest"."enrichment_results" (
	"job_id" bigint PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"content_revision" bigint NOT NULL,
	"job_type" text NOT NULL,
	"processor_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"produced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest"."input_snapshots" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"content_revision" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"stream_id" text NOT NULL,
	"topic" text NOT NULL,
	"partition" integer NOT NULL,
	"offset_value" bigint NOT NULL,
	"raw_bytes" "bytea" NOT NULL,
	"raw_sha256" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_revision_positive" CHECK (content_revision > 0)
);
--> statement-breakpoint
ALTER TABLE "ingest"."archive_links" ADD CONSTRAINT "archive_delivery_fk" FOREIGN KEY ("stream_id","topic","partition","offset_value") REFERENCES "ingest"."deliveries"("stream_id","topic","partition","offset_value") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."enrichment_jobs" ADD CONSTRAINT "job_item_fk" FOREIGN KEY ("item_id") REFERENCES "core"."item"("item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."enrichment_jobs" ADD CONSTRAINT "job_snapshot_fk" FOREIGN KEY ("event_id") REFERENCES "ingest"."input_snapshots"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."enrichment_results" ADD CONSTRAINT "result_job_fk" FOREIGN KEY ("job_id") REFERENCES "ingest"."enrichment_jobs"("job_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."enrichment_results" ADD CONSTRAINT "result_item_fk" FOREIGN KEY ("item_id") REFERENCES "core"."item"("item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."input_snapshots" ADD CONSTRAINT "snapshot_event_fk" FOREIGN KEY ("event_id") REFERENCES "ingest"."ingest_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."input_snapshots" ADD CONSTRAINT "snapshot_item_fk" FOREIGN KEY ("item_id") REFERENCES "core"."item"("item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."input_snapshots" ADD CONSTRAINT "snapshot_delivery_fk" FOREIGN KEY ("stream_id","topic","partition","offset_value") REFERENCES "ingest"."deliveries"("stream_id","topic","partition","offset_value") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archive_object_idx" ON "ingest"."archive_links" USING btree ("object_key","version_id");--> statement-breakpoint
CREATE INDEX "job_due_idx" ON "ingest"."enrichment_jobs" USING btree ("status","next_run_at","created_at");--> statement-breakpoint
CREATE INDEX "result_item_revision_idx" ON "ingest"."enrichment_results" USING btree ("item_id","content_revision");--> statement-breakpoint
CREATE INDEX "snapshot_item_revision_idx" ON "ingest"."input_snapshots" USING btree ("item_id","content_revision");