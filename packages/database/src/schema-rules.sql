-- Advanced PostgreSQL rules managed by reviewed migrations, not ORM auto-sync.
CREATE FUNCTION core.immutable_fields() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field text;
BEGIN
  FOREACH field IN ARRAY TG_ARGV LOOP
    IF to_jsonb(NEW)->field IS DISTINCT FROM to_jsonb(OLD)->field THEN
      RAISE EXCEPTION 'Identity field % cannot change', field USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER source_identity BEFORE UPDATE ON core.source FOR EACH ROW
EXECUTE FUNCTION core.immutable_fields('reality_id','source_id','platform');
CREATE TRIGGER author_identity BEFORE UPDATE ON core.author FOR EACH ROW
EXECUTE FUNCTION core.immutable_fields('reality_id','author_id','platform');
CREATE TRIGGER entity_identity BEFORE UPDATE ON core.entity FOR EACH ROW
EXECUTE FUNCTION core.immutable_fields('reality_id','entity_id','type');
CREATE TRIGGER query_identity BEFORE UPDATE ON core.collection_query FOR EACH ROW
EXECUTE FUNCTION core.immutable_fields('reality_id','query_id','platform','query_text');
CREATE TRIGGER item_identity BEFORE UPDATE ON core.item FOR EACH ROW
EXECUTE FUNCTION core.immutable_fields('item_id','reality_id','platform','native_id');

CREATE FUNCTION core.check_item_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content_revision < OLD.content_revision OR NEW.last_seen_at < OLD.last_seen_at THEN
    RAISE EXCEPTION 'Item revision and last_seen_at cannot go backwards' USING ERRCODE = '23514';
  END IF;
  IF (NEW.title IS DISTINCT FROM OLD.title OR NEW.content_text IS DISTINCT FROM OLD.content_text)
    AND NEW.content_revision <= OLD.content_revision THEN
    RAISE EXCEPTION 'Changed content requires a new revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER item_revision BEFORE UPDATE ON core.item FOR EACH ROW
EXECUTE FUNCTION core.check_item_revision();
CREATE TRIGGER event_identity BEFORE UPDATE ON ingest.ingest_events FOR EACH ROW
EXECUTE FUNCTION core.immutable_fields('event_id','reality_id','event_hash','schema_version','observed_at','ingested_at');
CREATE TRIGGER delivery_identity BEFORE UPDATE ON ingest.deliveries FOR EACH ROW
EXECUTE FUNCTION core.immutable_fields('stream_id','topic','partition','offset_value','event_id','raw_uri');
CREATE TRIGGER receipt_identity BEFORE UPDATE ON ingest.processing_receipts FOR EACH ROW
EXECUTE FUNCTION core.immutable_fields('event_id','processor_version','reality_id','item_id','processed_at');

CREATE FUNCTION core.check_entity_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_id text; linked_type text;
BEGIN
  linked_id := to_jsonb(NEW)->>TG_ARGV[0];
  IF linked_id IS NULL THEN RETURN NEW; END IF;
  SELECT type INTO linked_type FROM core.entity
    WHERE reality_id = NEW.reality_id AND entity_id = linked_id FOR KEY SHARE;
  IF linked_type IS NULL THEN
    RAISE EXCEPTION 'Referenced entity does not exist' USING ERRCODE = '23503';
  END IF;
  IF (TG_TABLE_NAME = 'item_entity' AND linked_type NOT IN ('PER','ORG'))
     OR (TG_TABLE_NAME <> 'item_entity' AND linked_type <> 'LOC') THEN
    RAISE EXCEPTION 'Entity type does not match relationship' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER author_place_type BEFORE INSERT OR UPDATE ON core.author
FOR EACH ROW EXECUTE FUNCTION core.check_entity_link('profile_place_id');
CREATE TRIGGER location_place_type BEFORE INSERT OR UPDATE ON core.item_location
FOR EACH ROW EXECUTE FUNCTION core.check_entity_link('place_id');
CREATE TRIGGER mentioned_entity_type BEFORE INSERT OR UPDATE ON core.item_entity
FOR EACH ROW EXECUTE FUNCTION core.check_entity_link('entity_id');

CREATE FUNCTION core.check_query_platform() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item_platform text; query_platform text;
BEGIN
  SELECT platform INTO item_platform FROM core.item
    WHERE reality_id = NEW.reality_id AND item_id = NEW.item_id FOR KEY SHARE;
  SELECT platform INTO query_platform FROM core.collection_query
    WHERE reality_id = NEW.reality_id AND query_id = NEW.query_id FOR KEY SHARE;
  IF item_platform IS NULL OR query_platform IS NULL THEN
    RAISE EXCEPTION 'Item or query does not exist in this reality' USING ERRCODE = '23503';
  END IF;
  IF item_platform <> query_platform THEN
    RAISE EXCEPTION 'Query and item platforms differ' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER query_platform_match BEFORE INSERT OR UPDATE ON core.item_query_match
FOR EACH ROW EXECUTE FUNCTION core.check_query_platform();

CREATE FUNCTION core.check_enrichment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision bigint;
BEGIN
  SELECT content_revision INTO current_revision FROM core.item WHERE item_id = NEW.item_id FOR SHARE;
  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'Item does not exist' USING ERRCODE = '23503';
  END IF;
  IF NEW.content_revision <> current_revision THEN
    RAISE EXCEPTION 'Enrichment revision is stale' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER classification_revision BEFORE INSERT OR UPDATE ON core.classification
FOR EACH ROW EXECUTE FUNCTION core.check_enrichment_revision();
CREATE TRIGGER embedding_revision BEFORE INSERT OR UPDATE ON core.embedding
FOR EACH ROW EXECUTE FUNCTION core.check_enrichment_revision();
CREATE TRIGGER topic_revision BEFORE INSERT OR UPDATE ON core.item_topic
FOR EACH ROW EXECUTE FUNCTION core.check_enrichment_revision();
CREATE TRIGGER location_revision BEFORE INSERT OR UPDATE ON core.item_location
FOR EACH ROW EXECUTE FUNCTION core.check_enrichment_revision();
CREATE TRIGGER entity_revision BEFORE INSERT OR UPDATE ON core.item_entity
FOR EACH ROW EXECUTE FUNCTION core.check_enrichment_revision();

CREATE FUNCTION core.check_duplicate_root() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_duplicate text;
BEGIN
  IF NEW.dup_of IS NULL THEN RETURN NEW; END IF;
  -- Duplicate linking is infrequent; serialize graph mutations within a reality.
  PERFORM pg_advisory_xact_lock(78234624, NEW.reality_id);
  SELECT dup_of INTO parent_duplicate FROM core.item
    WHERE reality_id = NEW.reality_id AND item_id = NEW.dup_of FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Duplicate root does not exist' USING ERRCODE = '23503';
  END IF;
  IF parent_duplicate IS NOT NULL OR NEW.dup_of = NEW.item_id OR EXISTS (
    SELECT 1 FROM core.item WHERE reality_id = NEW.reality_id AND dup_of = NEW.item_id
  ) THEN
    RAISE EXCEPTION 'Duplicates must point directly to a root without cycles' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER duplicate_root BEFORE INSERT OR UPDATE OF dup_of ON core.item
FOR EACH ROW EXECUTE FUNCTION core.check_duplicate_root();
