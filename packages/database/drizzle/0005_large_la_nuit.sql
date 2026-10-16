CREATE TABLE "ingest"."delivery_snapshots" (
	"stream_id" text NOT NULL,
	"topic" text NOT NULL,
	"partition" integer NOT NULL,
	"offset_value" bigint NOT NULL,
	"event_id" uuid NOT NULL,
	"raw_bytes" "bytea" NOT NULL,
	"raw_sha256" text NOT NULL,
	CONSTRAINT "delivery_snapshots_pk" PRIMARY KEY("stream_id","topic","partition","offset_value")
);
--> statement-breakpoint
ALTER TABLE "ingest"."delivery_snapshots" ADD CONSTRAINT "delivery_snapshot_fk" FOREIGN KEY ("stream_id","topic","partition","offset_value") REFERENCES "ingest"."deliveries"("stream_id","topic","partition","offset_value") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."delivery_snapshots" ADD CONSTRAINT "delivery_snapshot_event_fk" FOREIGN KEY ("event_id") REFERENCES "ingest"."ingest_events"("event_id") ON DELETE restrict ON UPDATE no action;