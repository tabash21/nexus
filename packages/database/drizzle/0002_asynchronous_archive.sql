ALTER TABLE "core"."item" ALTER COLUMN "raw_uri" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "ingest"."deliveries" ALTER COLUMN "raw_uri" DROP NOT NULL;
--> statement-breakpoint


DROP TRIGGER delivery_identity ON ingest.deliveries;
--> statement-breakpoint

CREATE TRIGGER delivery_identity BEFORE UPDATE ON ingest.deliveries FOR EACH ROW
EXECUTE FUNCTION core.immutable_fields('stream_id','topic','partition','offset_value','event_id');
--> statement-breakpoint

CREATE FUNCTION ingest.check_archive_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.raw_uri IS NOT NULL AND NEW.raw_uri IS DISTINCT FROM OLD.raw_uri THEN
    RAISE EXCEPTION 'An archive link cannot be replaced' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER delivery_archive_link BEFORE UPDATE OF raw_uri ON ingest.deliveries
FOR EACH ROW EXECUTE FUNCTION ingest.check_archive_link();
--> statement-breakpoint

COMMENT ON COLUMN core.item.raw_uri IS 'Nullable until Kafka Connect archive location is resolved for the current event.';
--> statement-breakpoint

COMMENT ON COLUMN ingest.deliveries.raw_uri IS 'Nullable until the exact Connect object is resolved; once filled it is immutable.';
