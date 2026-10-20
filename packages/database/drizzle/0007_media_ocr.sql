CREATE TABLE "ingest"."media_jobs" (
	"job_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"position" smallint NOT NULL,
	"attachment_generation" uuid NOT NULL,
	"processor_version" text NOT NULL,
	"source_url" text,
	"media_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"lease_until" timestamp with time zone,
	"archive_uri" text,
	"outcome" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_job_identity" UNIQUE("item_id","position","attachment_generation","processor_version"),
	CONSTRAINT "media_job_position_valid" CHECK (position >= 0),
	CONSTRAINT "media_job_attempts_valid" CHECK (attempts >= 0 AND max_attempts > 0),
	CONSTRAINT "media_job_status_valid" CHECK (status IN ('pending','running','succeeded','failed','stale')),
	CONSTRAINT "media_job_lease_valid" CHECK ((status = 'running') = (claim_token IS NOT NULL AND lease_until IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "core"."item_media" ADD COLUMN "attachment_generation" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest"."media_jobs" ADD CONSTRAINT "media_job_item_fk" FOREIGN KEY ("item_id") REFERENCES "core"."item"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_job_due_idx" ON "ingest"."media_jobs" USING btree ("status","next_run_at","created_at");