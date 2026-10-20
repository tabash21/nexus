-- Declarative Artemis snapshot, equivalent to the applied Drizzle migration chain.


CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE SCHEMA "core";
--> statement-breakpoint
CREATE SCHEMA "ingest";
--> statement-breakpoint
CREATE TYPE "core"."geo_kind" AS ENUM('geotag', 'content');--> statement-breakpoint
CREATE TYPE "core"."item_type" AS ENUM('post', 'reply', 'quote', 'repost', 'forward', 'comment', 'article', 'video', 'story');--> statement-breakpoint
CREATE TYPE "core"."time_source" AS ENUM('platform', 'feed', 'page_extracted', 'collected_at_fallback');--> statement-breakpoint
CREATE TABLE "core"."reality" (
	"reality_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reality_pk" PRIMARY KEY("reality_id"),
	CONSTRAINT "reality_id_nonnegative" CHECK (reality_id >= 0)
);
--> statement-breakpoint
CREATE TABLE "core"."platform" (
	"platform" text NOT NULL,
	"display_name" text NOT NULL,
	CONSTRAINT "platform_pk" PRIMARY KEY("platform"),
	CONSTRAINT "platform_code" CHECK (platform ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "core"."topic" (
	"topic_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "topic_pk" PRIMARY KEY("topic_id")
);
--> statement-breakpoint
CREATE TABLE "core"."source" (
	"source_id" text NOT NULL,
	"platform" text NOT NULL,
	"source_kind" text NOT NULL,
	"handle_or_url" text,
	"display_name" text,
	"arena" text,
	"home_country" char(2),
	"default_language" text,
	"subscribers" bigint,
	"tier" text,
	"added_by" text,
	"reason" text,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reality_id" integer DEFAULT 0 NOT NULL,
	"metadata_observed_at" timestamp with time zone,
	CONSTRAINT "source_pk" PRIMARY KEY("reality_id","source_id"),
	CONSTRAINT "source_identity_platform" UNIQUE("reality_id","source_id","platform"),
	CONSTRAINT "source_subscribers_nonnegative" CHECK (subscribers >= 0),
	CONSTRAINT "source_kind_allowed" CHECK (source_kind IN ('channel','site','subreddit','page','group','account','search')),
	CONSTRAINT "source_arena_allowed" CHECK (arena IN ('IL','ARAB','INTL')),
	CONSTRAINT "source_tier_allowed" CHECK (tier IN ('watchlist','discovery'))
);
--> statement-breakpoint
CREATE TABLE "core"."entity" (
	"entity_id" text NOT NULL,
	"type" text NOT NULL,
	"canonical_name" text NOT NULL,
	"country" char(2),
	"admin1" text,
	"geonames_id" bigint,
	"geom" geography(Point, 4326),
	"reality_id" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "entity_pk" PRIMARY KEY("reality_id","entity_id"),
	CONSTRAINT "entity_identity_type" UNIQUE("reality_id","entity_id","type"),
	CONSTRAINT "entity_type_allowed" CHECK (type IN ('PER','ORG','LOC')),
	CONSTRAINT "entity_place_properties" CHECK (type = 'LOC' OR (country IS NULL AND admin1 IS NULL AND geonames_id IS NULL AND geom IS NULL))
);
--> statement-breakpoint
CREATE TABLE "core"."author" (
	"author_id" text NOT NULL,
	"native_user_id" text,
	"handle" text,
	"display_name" text,
	"bio" text,
	"profile_location" text,
	"profile_place_id" text,
	"followers" bigint,
	"following" bigint,
	"posts_count" bigint,
	"verified" boolean,
	"verified_type" text,
	"account_created_at" timestamp with time zone,
	"is_automated" boolean,
	"bot_score" real,
	"profile_seen_at" timestamp with time zone NOT NULL,
	"reality_id" integer DEFAULT 0 NOT NULL,
	"platform" text NOT NULL,
	CONSTRAINT "author_pk" PRIMARY KEY("reality_id","author_id"),
	CONSTRAINT "author_identity_platform" UNIQUE("reality_id","author_id","platform"),
	CONSTRAINT "author_bot_score_range" CHECK (bot_score >= 0 AND bot_score <= 1),
	CONSTRAINT "author_followers_nonnegative" CHECK (followers >= 0),
	CONSTRAINT "author_following_nonnegative" CHECK (following >= 0),
	CONSTRAINT "author_posts_count_nonnegative" CHECK (posts_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "core"."collection_query" (
	"reality_id" integer NOT NULL,
	"query_id" text NOT NULL,
	"platform" text NOT NULL,
	"query_text" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "collection_query_pk" PRIMARY KEY("reality_id","query_id")
);
--> statement-breakpoint
CREATE TABLE "ingest"."ingest_events" (
	"event_id" uuid NOT NULL,
	"event_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"reality_id" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_events_pk" PRIMARY KEY("event_id"),
	CONSTRAINT "ingest_event_reality_identity" UNIQUE("event_id","reality_id")
);
--> statement-breakpoint
CREATE TABLE "core"."item" (
	"item_id" text NOT NULL,
	"reality_id" integer DEFAULT 0 NOT NULL,
	"platform" text NOT NULL,
	"native_id" text NOT NULL,
	"url" text,
	"item_type" "core"."item_type" NOT NULL,
	"schema_version" text DEFAULT 'item.v1' NOT NULL,
	"source_id" text NOT NULL,
	"author_id" text,
	"author_name_raw" text,
	"published_at" timestamp with time zone NOT NULL,
	"published_at_source" "core"."time_source" NOT NULL,
	"edited_at" timestamp with time zone,
	"collected_at" timestamp with time zone NOT NULL,
	"title" text,
	"content_text" text NOT NULL,
	"lang" text,
	"lang_confidence" real,
	"lang_platform" text,
	"hashtags" text[] DEFAULT '{}' NOT NULL,
	"mentions" text[] DEFAULT '{}' NOT NULL,
	"links" text[] DEFAULT '{}' NOT NULL,
	"is_sensitive" boolean,
	"reply_to_item_id" text,
	"conversation_id" text,
	"quoted_item_id" text,
	"shared_from_item_id" text,
	"shared_from_source" text,
	"content_hash" text NOT NULL,
	"simhash" bigint,
	"dup_of" text,
	"deleted_at" timestamp with time zone,
	"collector" text NOT NULL,
	"provider" text NOT NULL,
	"raw_uri" text,
	"platform_extra" jsonb DEFAULT '{}' NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || content_text)) STORED,
	"last_seen_at" timestamp with time zone NOT NULL,
	"current_event_id" uuid NOT NULL,
	"content_revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "item_pk" PRIMARY KEY("item_id"),
	CONSTRAINT "item_natural_identity" UNIQUE("reality_id","platform","native_id"),
	CONSTRAINT "item_reality_identity" UNIQUE("reality_id","item_id"),
	CONSTRAINT "item_lang_confidence_range" CHECK (lang_confidence >= 0 AND lang_confidence <= 1),
	CONSTRAINT "item_revision_positive" CHECK (content_revision > 0),
	CONSTRAINT "item_not_own_duplicate" CHECK (dup_of IS NULL OR dup_of <> item_id),
	CONSTRAINT "item_last_seen_order" CHECK (last_seen_at >= collected_at),
	CONSTRAINT "item_extra_object" CHECK (jsonb_typeof(platform_extra) = 'object')
);
--> statement-breakpoint
CREATE TABLE "core"."item_media" (
	"item_id" text NOT NULL,
	"position" smallint NOT NULL,
	"media_type" text NOT NULL,
	"media_url" text,
	"thumb_url" text,
	"duration_s" real,
	"width" integer,
	"height" integer,
	"alt_text" text,
	"s3_uri" text,
	"ocr_text" text,
	"transcript" text,
	CONSTRAINT "item_media_pk" PRIMARY KEY("item_id","position"),
	CONSTRAINT "item_media_position_nonnegative" CHECK (position >= 0),
	CONSTRAINT "media_type_allowed" CHECK (media_type IN ('image','video','audio','document','link_card')),
	CONSTRAINT "media_dimensions_positive" CHECK ((width IS NULL OR width > 0) AND (height IS NULL OR height > 0)),
	CONSTRAINT "media_duration_valid" CHECK (duration_s >= 0 AND duration_s < 'Infinity'::real)
);
--> statement-breakpoint
CREATE TABLE "core"."engagement_snapshot" (
	"snapshot_id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid,
	"item_id" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"views" bigint,
	"likes" bigint,
	"likes_kind" text,
	"reposts" bigint,
	"replies" bigint,
	"quotes" bigint,
	"saves" bigint,
	"reactions" jsonb,
	"provider" text NOT NULL,
	CONSTRAINT "engagement_snapshot_event_uk" UNIQUE("event_id"),
	CONSTRAINT "engagement_snapshot_views_nonnegative" CHECK (views >= 0),
	CONSTRAINT "engagement_snapshot_reposts_nonnegative" CHECK (reposts >= 0),
	CONSTRAINT "engagement_snapshot_replies_nonnegative" CHECK (replies >= 0),
	CONSTRAINT "engagement_snapshot_quotes_nonnegative" CHECK (quotes >= 0),
	CONSTRAINT "engagement_snapshot_saves_nonnegative" CHECK (saves >= 0),
	CONSTRAINT "engagement_likes_kind" CHECK (likes_kind IN ('like','heart','score','reactions')),
	CONSTRAINT "engagement_likes_valid" CHECK (likes IS NULL OR (likes_kind IS NOT NULL AND (likes_kind = 'score' OR likes >= 0))),
	CONSTRAINT "engagement_reactions_object" CHECK (jsonb_typeof(reactions) = 'object')
);
--> statement-breakpoint
CREATE TABLE "core"."item_query_match" (
	"item_id" text NOT NULL,
	"query_id" text NOT NULL,
	"matched_at" timestamp with time zone NOT NULL,
	"reality_id" integer NOT NULL,
	CONSTRAINT "item_query_match_pk" PRIMARY KEY("item_id","query_id")
);
--> statement-breakpoint
CREATE TABLE "core"."classification" (
	"item_id" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"relevance" real,
	"misinfo_score" real,
	"sentiment" text,
	"summary_en" text,
	"classified_at" timestamp with time zone NOT NULL,
	"content_revision" bigint NOT NULL,
	CONSTRAINT "classification_pk" PRIMARY KEY("item_id"),
	CONSTRAINT "classification_relevance_range" CHECK (relevance >= 0 AND relevance <= 1),
	CONSTRAINT "classification_misinfo_score_range" CHECK (misinfo_score >= 0 AND misinfo_score <= 1),
	CONSTRAINT "classification_revision_positive" CHECK (content_revision > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."item_topic" (
	"item_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"score" real NOT NULL,
	"content_revision" bigint NOT NULL,
	CONSTRAINT "item_topic_pk" PRIMARY KEY("item_id","topic_id"),
	CONSTRAINT "item_topic_score_range" CHECK (score >= 0 AND score <= 1),
	CONSTRAINT "item_topic_revision_positive" CHECK (content_revision > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."embedding" (
	"item_id" text NOT NULL,
	"model" text NOT NULL,
	"content_vec" vector(1024) NOT NULL,
	"title_vec" vector(1024),
	"embedded_at" timestamp with time zone NOT NULL,
	"content_revision" bigint NOT NULL,
	CONSTRAINT "embedding_pk" PRIMARY KEY("item_id"),
	CONSTRAINT "embedding_revision_positive" CHECK (content_revision > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."item_location" (
	"item_id" text NOT NULL,
	"place_id" text NOT NULL,
	"geo_kind" "core"."geo_kind" NOT NULL,
	"surface_form" text,
	"confidence" real,
	"content_revision" bigint NOT NULL,
	"reality_id" integer NOT NULL,
	CONSTRAINT "item_location_pk" PRIMARY KEY("item_id","place_id","geo_kind"),
	CONSTRAINT "item_location_confidence_range" CHECK (confidence >= 0 AND confidence <= 1),
	CONSTRAINT "item_location_revision_positive" CHECK (content_revision > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."item_entity" (
	"item_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"surface_form" text NOT NULL,
	"content_revision" bigint NOT NULL,
	"reality_id" integer NOT NULL,
	CONSTRAINT "item_entity_pk" PRIMARY KEY("item_id","entity_id","surface_form"),
	CONSTRAINT "item_entity_revision_positive" CHECK (content_revision > 0)
);
--> statement-breakpoint
CREATE TABLE "ingest"."deliveries" (
	"stream_id" text NOT NULL,
	"topic" text NOT NULL,
	"partition" integer NOT NULL,
	"offset_value" bigint NOT NULL,
	"event_id" uuid NOT NULL,
	"raw_uri" text,
	CONSTRAINT "deliveries_pk" PRIMARY KEY("stream_id","topic","partition","offset_value"),
	CONSTRAINT "deliveries_partition_nonnegative" CHECK (partition >= 0),
	CONSTRAINT "deliveries_offset_value_nonnegative" CHECK (offset_value >= 0)
);
--> statement-breakpoint
CREATE TABLE "ingest"."processing_receipts" (
	"event_id" uuid NOT NULL,
	"processor_version" text NOT NULL,
	"reality_id" integer NOT NULL,
	"item_id" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_receipts_pk" PRIMARY KEY("event_id","processor_version")
);
--> statement-breakpoint
ALTER TABLE "core"."source" ADD CONSTRAINT "source_reality_fk" FOREIGN KEY ("reality_id") REFERENCES "core"."reality"("reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."source" ADD CONSTRAINT "source_platform_fk" FOREIGN KEY ("platform") REFERENCES "core"."platform"("platform") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."entity" ADD CONSTRAINT "entity_reality_fk" FOREIGN KEY ("reality_id") REFERENCES "core"."reality"("reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."author" ADD CONSTRAINT "author_reality_fk" FOREIGN KEY ("reality_id") REFERENCES "core"."reality"("reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."author" ADD CONSTRAINT "author_platform_fk" FOREIGN KEY ("platform") REFERENCES "core"."platform"("platform") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."author" ADD CONSTRAINT "author_profile_place_fk" FOREIGN KEY ("reality_id","profile_place_id") REFERENCES "core"."entity"("reality_id","entity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."collection_query" ADD CONSTRAINT "collection_query_reality_fk" FOREIGN KEY ("reality_id") REFERENCES "core"."reality"("reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."collection_query" ADD CONSTRAINT "collection_query_platform_fk" FOREIGN KEY ("platform") REFERENCES "core"."platform"("platform") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."ingest_events" ADD CONSTRAINT "ingest_events_reality_fk" FOREIGN KEY ("reality_id") REFERENCES "core"."reality"("reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item" ADD CONSTRAINT "item_reality_fk" FOREIGN KEY ("reality_id") REFERENCES "core"."reality"("reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item" ADD CONSTRAINT "item_platform_fk" FOREIGN KEY ("platform") REFERENCES "core"."platform"("platform") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item" ADD CONSTRAINT "item_source_fk" FOREIGN KEY ("reality_id","source_id","platform") REFERENCES "core"."source"("reality_id","source_id","platform") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item" ADD CONSTRAINT "item_author_fk" FOREIGN KEY ("reality_id","author_id","platform") REFERENCES "core"."author"("reality_id","author_id","platform") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item" ADD CONSTRAINT "item_duplicate_fk" FOREIGN KEY ("reality_id","dup_of") REFERENCES "core"."item"("reality_id","item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item" ADD CONSTRAINT "item_current_event_fk" FOREIGN KEY ("current_event_id","reality_id") REFERENCES "ingest"."ingest_events"("event_id","reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item_media" ADD CONSTRAINT "item_media_item_fk" FOREIGN KEY ("item_id") REFERENCES "core"."item"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."engagement_snapshot" ADD CONSTRAINT "engagement_snapshot_item_fk" FOREIGN KEY ("item_id") REFERENCES "core"."item"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "engagement_snapshot_latest_idx" ON "core"."engagement_snapshot" USING btree ("item_id","captured_at" DESC NULLS LAST,"snapshot_id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "core"."item_query_match" ADD CONSTRAINT "item_query_match_reality_fk" FOREIGN KEY ("reality_id") REFERENCES "core"."reality"("reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item_query_match" ADD CONSTRAINT "item_query_match_item_fk" FOREIGN KEY ("reality_id","item_id") REFERENCES "core"."item"("reality_id","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item_query_match" ADD CONSTRAINT "item_query_match_query_fk" FOREIGN KEY ("reality_id","query_id") REFERENCES "core"."collection_query"("reality_id","query_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."classification" ADD CONSTRAINT "classification_item_fk" FOREIGN KEY ("item_id") REFERENCES "core"."item"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item_topic" ADD CONSTRAINT "item_topic_item_fk" FOREIGN KEY ("item_id") REFERENCES "core"."item"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item_topic" ADD CONSTRAINT "item_topic_topic_fk" FOREIGN KEY ("topic_id") REFERENCES "core"."topic"("topic_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."embedding" ADD CONSTRAINT "embedding_item_fk" FOREIGN KEY ("item_id") REFERENCES "core"."item"("item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item_location" ADD CONSTRAINT "item_location_reality_fk" FOREIGN KEY ("reality_id") REFERENCES "core"."reality"("reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item_location" ADD CONSTRAINT "item_location_item_fk" FOREIGN KEY ("reality_id","item_id") REFERENCES "core"."item"("reality_id","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item_location" ADD CONSTRAINT "item_location_place_fk" FOREIGN KEY ("reality_id","place_id") REFERENCES "core"."entity"("reality_id","entity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item_entity" ADD CONSTRAINT "item_entity_reality_fk" FOREIGN KEY ("reality_id") REFERENCES "core"."reality"("reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item_entity" ADD CONSTRAINT "item_entity_item_fk" FOREIGN KEY ("reality_id","item_id") REFERENCES "core"."item"("reality_id","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."item_entity" ADD CONSTRAINT "item_entity_entity_fk" FOREIGN KEY ("reality_id","entity_id") REFERENCES "core"."entity"("reality_id","entity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."deliveries" ADD CONSTRAINT "delivery_event_fk" FOREIGN KEY ("event_id") REFERENCES "ingest"."ingest_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."processing_receipts" ADD CONSTRAINT "processing_receipts_reality_fk" FOREIGN KEY ("reality_id") REFERENCES "core"."reality"("reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."processing_receipts" ADD CONSTRAINT "receipt_event_fk" FOREIGN KEY ("event_id","reality_id") REFERENCES "ingest"."ingest_events"("event_id","reality_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest"."processing_receipts" ADD CONSTRAINT "receipt_item_fk" FOREIGN KEY ("reality_id","item_id") REFERENCES "core"."item"("reality_id","item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_geom_idx" ON "core"."entity" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "author_profile_place_idx" ON "core"."author" USING btree ("reality_id","profile_place_id");--> statement-breakpoint
CREATE INDEX "item_listing" ON "core"."item" USING btree ("reality_id","published_at" DESC NULLS LAST,"item_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "item_platform_listing" ON "core"."item" USING btree ("reality_id","platform","published_at" DESC NULLS LAST,"item_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "item_source_id_listing" ON "core"."item" USING btree ("reality_id","source_id","published_at" DESC NULLS LAST,"item_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "item_author_id_listing" ON "core"."item" USING btree ("reality_id","author_id","published_at" DESC NULLS LAST,"item_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "item_lang_listing" ON "core"."item" USING btree ("reality_id","lang","published_at" DESC NULLS LAST,"item_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "item_tsv_idx" ON "core"."item" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "item_trgm_idx" ON "core"."item" USING gin ("content_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "item_hashtags_idx" ON "core"."item" USING gin ("hashtags");--> statement-breakpoint
CREATE INDEX "item_links_idx" ON "core"."item" USING gin ("links");--> statement-breakpoint
CREATE INDEX "item_dup_of_idx" ON "core"."item" USING btree ("reality_id","dup_of") WHERE dup_of IS NOT NULL;--> statement-breakpoint
CREATE INDEX "item_reply_to_item_id_idx" ON "core"."item" USING btree ("reality_id","reply_to_item_id") WHERE reply_to_item_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "item_shared_from_item_id_idx" ON "core"."item" USING btree ("reality_id","shared_from_item_id") WHERE shared_from_item_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "item_conversation_id_idx" ON "core"."item" USING btree ("reality_id","conversation_id") WHERE conversation_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "item_current_event_idx" ON "core"."item" USING btree ("current_event_id");--> statement-breakpoint
CREATE INDEX "item_query_reverse_idx" ON "core"."item_query_match" USING btree ("reality_id","query_id","item_id");--> statement-breakpoint
CREATE INDEX "item_topic_reverse_idx" ON "core"."item_topic" USING btree ("topic_id","item_id");--> statement-breakpoint
CREATE INDEX "item_location_place_idx" ON "core"."item_location" USING btree ("reality_id","place_id","item_id");--> statement-breakpoint
CREATE INDEX "item_entity_reverse_idx" ON "core"."item_entity" USING btree ("reality_id","entity_id","item_id");--> statement-breakpoint
CREATE INDEX "delivery_event_idx" ON "ingest"."deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "receipt_item_idx" ON "ingest"."processing_receipts" USING btree ("reality_id","item_id");

INSERT INTO core.reality(reality_id,name) VALUES (0,'Real world');
INSERT INTO core.reality(reality_id,name) VALUES (1,'Simulation') ON CONFLICT(reality_id) DO NOTHING;

INSERT INTO core.platform(platform,display_name) VALUES ('telegram','Telegram'),('x','X'),('news','News'),('reddit','Reddit'),('threads','Threads'),('instagram','Instagram'),('tiktok','TikTok'),('youtube','YouTube'),('bluesky','Bluesky'),('facebook','Facebook');

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


CREATE VIEW core.item_ds AS
SELECT
  i.*,
  char_length(i.content_text) AS content_length,
  COALESCE((SELECT array_agg(domain ORDER BY domain) FROM (
    SELECT DISTINCT lower(substring(link FROM '^[a-zA-Z]+://([^/:?#]+)')) AS domain
    FROM unnest(i.links) AS link
  ) domains WHERE domain IS NOT NULL), '{}'::text[]) AS link_domains,
  EXISTS (SELECT 1 FROM core.item_media m WHERE m.item_id = i.item_id) AS has_media,
  e.views, e.likes, e.likes_kind, e.reposts, e.replies, e.quotes, e.saves, e.reactions,
  e.captured_at AS engagement_seen_at, e.provider AS engagement_provider,
  s.arena, s.source_kind, s.display_name AS source_name, s.subscribers AS source_subscribers,
  COALESCE(loc.geo_kind, CASE WHEN s.home_country IS NOT NULL THEN 'source_default' END) AS geo_kind,
  loc.place_name AS geo_place_name,
  CASE WHEN loc.place_id IS NOT NULL THEN loc.country ELSE s.home_country END AS geo_country,
  loc.lat, loc.lon,
  (SELECT count(*) FROM core.item d WHERE d.reality_id = i.reality_id AND d.dup_of = i.item_id) AS dup_count,
  i.deleted_at IS NOT NULL AS is_deleted,
  COALESCE(a.handle, i.author_name_raw) AS author,
  a.followers AS author_followers, a.verified AS author_verified,
  a.account_created_at AS author_created_at, a.bot_score,
  c.relevance, c.misinfo_score, c.sentiment, c.summary_en,
  COALESCE((SELECT array_agg(t.topic_id ORDER BY t.score DESC, t.topic_id)
    FROM core.item_topic t WHERE t.item_id = i.item_id AND t.content_revision = i.content_revision), '{}'::text[]) AS topics
FROM core.item i
JOIN core.source s ON s.reality_id = i.reality_id AND s.source_id = i.source_id
LEFT JOIN core.author a ON a.reality_id = i.reality_id AND a.author_id = i.author_id
LEFT JOIN core.classification c ON c.item_id = i.item_id AND c.content_revision = i.content_revision
LEFT JOIN LATERAL (
  SELECT es.views, es.likes, es.likes_kind, es.reposts, es.replies, es.quotes, es.saves,
    es.reactions, es.captured_at, es.provider FROM core.engagement_snapshot es WHERE es.item_id = i.item_id
  ORDER BY es.captured_at DESC, es.snapshot_id DESC LIMIT 1
) e ON true
LEFT JOIN LATERAL (
  SELECT x.place_id, x.kind AS geo_kind, p.canonical_name AS place_name, p.country,
    ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lon
  FROM (
    SELECT l.place_id, l.geo_kind::text AS kind,
      CASE l.geo_kind WHEN 'geotag' THEN 1 ELSE 2 END AS rank, l.confidence
    FROM core.item_location l
    WHERE l.item_id = i.item_id AND l.reality_id = i.reality_id AND l.content_revision = i.content_revision
    UNION ALL
    SELECT a.profile_place_id, 'author_profile', 3, NULL WHERE a.profile_place_id IS NOT NULL
  ) x JOIN core.entity p ON p.reality_id = i.reality_id AND p.entity_id = x.place_id
  ORDER BY x.rank, x.confidence DESC NULLS LAST, x.place_id LIMIT 1
) loc ON true;

COMMENT ON VIEW core.item_ds IS 'Current item projection across realities; callers must filter reality_id, defaulting to 0.';


COMMENT ON TABLE core.item IS 'פריט אחד לכל פוסט, תגובה, כתבה או סרטון שנאסף, מכל הפלטפורמות, מהעולם האמיתי ומהסימולטור';
COMMENT ON COLUMN core.item.item_id IS 'המפתח של הפריט בכל הצנרת. בעולם האמיתי sha1 של platform:native_id, כך שאותו פוסט מספק ראשי ומספק גיבוי מקבל אותו מזהה. בסימולטור מוסיפים את reality_id לתחילת המחרוזת, כדי שפריט משודר מחדש לא יתנגש במקור';
COMMENT ON COLUMN core.item.reality_id IS 'מאיזו מציאות הגיע הפריט. 0 הוא העולם האמיתי, ונקסוס כותב אותו כשהשדה חסר. מספר גדול מ-0 הוא ריצת סימולטור, והוא מוזרק על ידי צוות הסימולטור. כל ניתוח של העולם האמיתי מסנן reality_id = 0';
COMMENT ON COLUMN core.item.platform IS 'הפלטפורמה שממנה נאסף הפריט, אחת מעשר. חלק מהמפתח הטבעי של הפריט, ו-PostgreSQL מוודא שהיא זהה לפלטפורמה של המקור';
COMMENT ON COLUMN core.item.native_id IS 'המזהה של הפריט בפלטפורמה עצמה. באתרי חדשות, שאין להם מזהה, זה sha1 של הקישור הקנוני';
COMMENT ON COLUMN core.item.url IS 'קישור קנוני לפריט המקורי. נבנה מהמזהים כשה-API לא מחזיר קישור, כדי שכל פריט יהיה ניתן לפתיחה ולציטוט';
COMMENT ON COLUMN core.item.item_type IS 'סוג הפריט: post, reply, quote, repost, forward, comment, article, video או story. מאפשר להפריד תוכן מקורי מתגובות ושיתופים';
COMMENT ON COLUMN core.item.schema_version IS 'גרסת הסכמה שלפיה נכתב הפריט, כרגע item.v1. שינוי שובר מקבל גרסה חדשה';
COMMENT ON COLUMN core.item.source_id IS 'איפה פורסם: ערוץ, אתר, subreddit או עמוד. בפלטפורמות חשבון זה החשבון במעקב או השאילתה שמצאה את הפריט. מצביע על core.source, ומשם מגיעות הזירה ומדינת הבית';
COMMENT ON COLUMN core.item.author_id IS 'מי כתב, בפורמט platform:user_id. מצביע על core.author עם עוקבים, אימות וגיל חשבון. ריק כשאין חשבון כותב, למשל ערוץ Telegram בלי חתימה';
COMMENT ON COLUMN core.item.author_name_raw IS 'שם הכותב כטקסט כשאין לו חשבון: שם כותב בכתבה או חתימה בערוץ Telegram';
COMMENT ON COLUMN core.item.published_at IS 'מתי הפריט פורסם, ב-UTC. ציר הזמן של כל ניתוח';
COMMENT ON COLUMN core.item.published_at_source IS 'מאיפה הגיע זמן הפרסום: platform, feed, page_extracted, או collected_at_fallback כשלא היה זמן בכלל. אומר כמה לסמוך על published_at';
COMMENT ON COLUMN core.item.edited_at IS 'מתי הפריט נערך לאחרונה, כש-Telegram או X מדווחים על עריכה. עריכה אחרי שפוסט התפשט היא אות בפני עצמה';
COMMENT ON COLUMN core.item.collected_at IS 'מתי האוסף קיבל את הפריט. ההפרש מ-published_at הוא מדד הטריות של האיסוף';
COMMENT ON COLUMN core.item.title IS 'כותרת הפריט. קיימת רק בחדשות, Reddit ו-YouTube, ומקבלת embedding משלה ב-core.embedding';
COMMENT ON COLUMN core.item.content_text IS 'גוף הפריט כטקסט נקי, בלי HTML. מחרוזת ריקה בפוסט של מדיה בלבד. זה הטקסט שעובר סיווג ו-embedding';
COMMENT ON COLUMN core.item.lang IS 'שפת הפריט בקוד BCP-47 (he, ar, en). מזוהה אצלנו בכל פריט, כי רק X ו-Bluesky נותנות שפה';
COMMENT ON COLUMN core.item.lang_confidence IS 'ביטחון זיהוי השפה, בין 0 ל-1. ערך נמוך מסמן טקסט קצר או מעורב';
COMMENT ON COLUMN core.item.lang_platform IS 'השפה שהפלטפורמה עצמה טענה, כשהיא נותנת. נשמרת להשוואה מול lang';
COMMENT ON COLUMN core.item.hashtags IS 'התגיות בפריט, בלי #. מה-API כשיש, אחרת מפוענחות מהטקסט. מערך ריק כשאין';
COMMENT ON COLUMN core.item.mentions IS 'החשבונות שהוזכרו בפריט, בלי @. מערך ריק כשאין';
COMMENT ON COLUMN core.item.links IS 'הקישורים היוצאים מהפריט, אחרי פתיחת קישורים מקוצרים. הדומיינים מחושבים מהם ב-core.item_ds';
COMMENT ON COLUMN core.item.is_sensitive IS 'דגל תוכן רגיש של הפלטפורמה עצמה, כשהיא מסמנת';
COMMENT ON COLUMN core.item.reply_to_item_id IS 'item_id של הפריט שהפריט הזה מגיב לו, גם אם הפריט האב לא נאסף';
COMMENT ON COLUMN core.item.conversation_id IS 'item_id של שורש השרשור. מאפשר לשלוף דיון שלם בשאילתה אחת';
COMMENT ON COLUMN core.item.quoted_item_id IS 'item_id של הפריט המצוטט, ב-X, Threads ו-Bluesky';
COMMENT ON COLUMN core.item.shared_from_item_id IS 'item_id של המקור כשהפריט הוא ריטוויט, העברה ב-Telegram או crosspost ב-Reddit. האות המרכזי להתפשטות בין ערוצים';
COMMENT ON COLUMN core.item.shared_from_source IS 'הערוץ או החשבון המקורי של פריט משותף, כשהפריט המקורי עצמו לא ידוע';
COMMENT ON COLUMN core.item.content_hash IS 'sha1 של הטקסט אחרי נרמול (אותיות קטנות, רווחים מאוחדים). מזהה עותקים זהים';
COMMENT ON COLUMN core.item.simhash IS 'טביעת אצבע של 64 ביט לזיהוי עותקים כמעט זהים';
COMMENT ON COLUMN core.item.dup_of IS 'item_id של העותק הראשון שנראה, כשהפריט הוא עותק. עותק נשמר ולא נזרק, תמיד בתוך אותו reality_id. מספר העותקים מחושב מזה ב-core.item_ds';
COMMENT ON COLUMN core.item.deleted_at IS 'מתי נמצא שהפריט נמחק מהפלטפורמה. NULL אומר שהפריט עדיין קיים. מחיקה אחרי התפשטות היא מידע בפני עצמו';
COMMENT ON COLUMN core.item.collector IS 'השירות שאסף, למשל x-ingest או telegram-collector';
COMMENT ON COLUMN core.item.provider IS 'הספק שממנו הגיע הפריט, למשל twitterapi.io, socialdata או rsshub. מאפשר להשוות ספק ראשי לגיבוי';
COMMENT ON COLUMN core.item.raw_uri IS 'מצביע להודעה הגולמית ב-S3 bronze. שדה ששכחנו אפשר לחלץ משם ולהריץ מחדש';
COMMENT ON COLUMN core.item.platform_extra IS 'שדות שיש רק לפלטפורמה אחת, כמו flair ב-Reddit או מוזיקה ב-TikTok. כך לא מאבדים מידע בלי להרחיב את הסכמה';
COMMENT ON COLUMN core.item.tsv IS 'אינדקס חיפוש מלא על הכותרת והתוכן יחד. PostgreSQL מחשב אותו, ואף שירות לא כותב אליו';
COMMENT ON COLUMN core.source.source_id IS 'מזהה המקור, בפורמט platform:id או דומיין';
COMMENT ON COLUMN core.source.platform IS 'הפלטפורמה של המקור. האוספים קוראים לפיה את רשימת המקורות שלהם';
COMMENT ON COLUMN core.source.source_kind IS 'סוג המקור: channel, site, subreddit, page, group, account או search';
COMMENT ON COLUMN core.source.handle_or_url IS 'שם הערוץ או כתובת האתר כפי שמופיעים ברישום';
COMMENT ON COLUMN core.source.display_name IS 'השם המוצג של המקור';
COMMENT ON COLUMN core.source.arena IS 'הזירה של המקור: IL, ARAB או INTL. נשמרת רק כאן, וכל פריט מקבל אותה דרך source_id. משמשת לחלוקת כל הדשבורדים וההתרעות';
COMMENT ON COLUMN core.source.home_country IS 'מדינת הבית של המקור. כשאין לפריט מיקום אחר, core.item_ds מציג אותה כמיקום מסוג source_default';
COMMENT ON COLUMN core.source.default_language IS 'שפת ברירת המחדל של המקור, לבדיקת זיהוי השפה';
COMMENT ON COLUMN core.source.subscribers IS 'מנויי הערוץ, ה-subreddit או העמוד. מדד לחשיפה הפוטנציאלית';
COMMENT ON COLUMN core.source.tier IS 'watchlist למקור במעקב צמוד, discovery למקור שנמצא בחיפוש';
COMMENT ON COLUMN core.source.added_by IS 'מי הוסיף את המקור, לפי ה-git author';
COMMENT ON COLUMN core.source.reason IS 'למה המקור נוסף, מה-Merge Request';
COMMENT ON COLUMN core.source.active IS 'האם המקור נאסף כרגע';
COMMENT ON COLUMN core.source.updated_at IS 'מתי השורה עודכנה לאחרונה';
COMMENT ON COLUMN core.author.author_id IS 'מזהה הכותב, platform:user_id, או platform:@handle כשאין מזהה. הפלטפורמה היא תחילית המזהה, ולכן אין לה עמודה נפרדת';
COMMENT ON COLUMN core.author.native_user_id IS 'מזהה המשתמש בפלטפורמה. לא משתנה כשהמשתמש מחליף שם';
COMMENT ON COLUMN core.author.handle IS 'שם המשתמש, בלי @';
COMMENT ON COLUMN core.author.display_name IS 'השם המוצג בפרופיל';
COMMENT ON COLUMN core.author.bio IS 'תיאור הפרופיל';
COMMENT ON COLUMN core.author.profile_location IS 'המיקום שהמשתמש כתב בפרופיל, כטקסט חופשי ולא מאומת';
COMMENT ON COLUMN core.author.profile_place_id IS 'המקום בגזטיר (core.entity) שאליו מופה טקסט המיקום מהפרופיל. נשמר פעם אחת לכותב, לא בכל פריט שלו';
COMMENT ON COLUMN core.author.followers IS 'מספר העוקבים ברגע profile_seen_at';
COMMENT ON COLUMN core.author.following IS 'מספר החשבונות שהמשתמש עוקב אחריהם. יחס חריג לעוקבים הוא סימן לבוט';
COMMENT ON COLUMN core.author.posts_count IS 'מספר הפוסטים של החשבון';
COMMENT ON COLUMN core.author.verified IS 'האם החשבון מאומת';
COMMENT ON COLUMN core.author.verified_type IS 'סוג האימות כפי שהפלטפורמה קוראת לו, למשל blue או government';
COMMENT ON COLUMN core.author.account_created_at IS 'מתי נפתח החשבון. חשבון חדש שמפרסם הרבה הוא אות לקמפיין';
COMMENT ON COLUMN core.author.is_automated IS 'תווית חשבון אוטומטי של הפלטפורמה עצמה (X)';
COMMENT ON COLUMN core.author.bot_score IS 'הערכת אנומליות לסבירות שהחשבון הוא בוט, בין 0 ל-1';
COMMENT ON COLUMN core.author.profile_seen_at IS 'מתי נקלטו נתוני הפרופיל והעוקבים';
COMMENT ON COLUMN core.item_media.item_id IS 'הפריט שהמדיה שייכת לו';
COMMENT ON COLUMN core.item_media.position IS 'הסדר של המדיה בפריט, מ-0';
COMMENT ON COLUMN core.item_media.media_type IS 'image, video, audio, document או link_card';
COMMENT ON COLUMN core.item_media.media_url IS 'קישור לקובץ אצל הפלטפורמה. עלול לפוג';
COMMENT ON COLUMN core.item_media.thumb_url IS 'קישור לתמונה ממוזערת';
COMMENT ON COLUMN core.item_media.duration_s IS 'אורך וידאו או אודיו בשניות';
COMMENT ON COLUMN core.item_media.width IS 'רוחב בפיקסלים';
COMMENT ON COLUMN core.item_media.height IS 'גובה בפיקסלים';
COMMENT ON COLUMN core.item_media.alt_text IS 'טקסט חלופי שהכותב הוסיף';
COMMENT ON COLUMN core.item_media.s3_uri IS 'העותק שלנו ב-S3, כשהקובץ הורד';
COMMENT ON COLUMN core.item_media.ocr_text IS 'טקסט שחולץ מהתמונה. ריק עד שיהיה שירות OCR';
COMMENT ON COLUMN core.item_media.transcript IS 'תמלול של וידאו או אודיו. ריק עד שיהיה שירות תמלול';
COMMENT ON COLUMN core.item_location.item_id IS 'הפריט';
COMMENT ON COLUMN core.item_location.place_id IS 'המקום בגזטיר (core.entity). שם, מדינה וקואורדינטות נשמרים שם פעם אחת לכל מקום';
COMMENT ON COLUMN core.item_location.geo_kind IS 'geotag כשהפוסט עצמו מתויג במקום, content כשהמקום מוזכר בטקסט. אסור להציג את השניים על מפה בלי ההבחנה';
COMMENT ON COLUMN core.item_location.surface_form IS 'איך המקום הופיע בפוסט או בתיוג';
COMMENT ON COLUMN core.item_location.confidence IS 'ביטחון בזיהוי המקום, בין 0 ל-1';
COMMENT ON COLUMN core.engagement_snapshot.item_id IS 'הפריט';
COMMENT ON COLUMN core.engagement_snapshot.captured_at IS 'מתי נמדד. השורה הראשונה היא רגע האיסוף, ואחריה מדידות ב-15 דקות, שעה ו-6 שעות מהפרסום. core.item_ds מציג את האחרונה';
COMMENT ON COLUMN core.engagement_snapshot.views IS 'מספר הצפיות. NULL כשהפלטפורמה לא נותנת, 0 רק כשהיא אמרה 0';
COMMENT ON COLUMN core.engagement_snapshot.likes IS 'מספר הלייקים. המשמעות תלויה ב-likes_kind';
COMMENT ON COLUMN core.engagement_snapshot.likes_kind IS 'מה נמדד ב-likes: like, heart, score (Reddit, למעלה פחות למטה) או reactions (סך תגובות האימוג''י). בלי זה אי אפשר להשוות בין פלטפורמות';
COMMENT ON COLUMN core.engagement_snapshot.reposts IS 'מספר השיתופים: ריטוויטים, העברות ב-Telegram או שיתופים';
COMMENT ON COLUMN core.engagement_snapshot.replies IS 'מספר התגובות על הפריט';
COMMENT ON COLUMN core.engagement_snapshot.quotes IS 'מספר הציטוטים, ב-X וב-Bluesky';
COMMENT ON COLUMN core.engagement_snapshot.saves IS 'מספר השמירות: bookmarks ב-X, collects ב-TikTok';
COMMENT ON COLUMN core.engagement_snapshot.reactions IS 'פירוט התגובות לפי אימוג''י, ב-Telegram וב-Facebook';
COMMENT ON COLUMN core.item_query_match.item_id IS 'הפריט';
COMMENT ON COLUMN core.item_query_match.query_id IS 'השאילתה מרישום המקורות שתפסה אותו. משמש לבקרת איכות שאילתות';
COMMENT ON COLUMN core.item_query_match.matched_at IS 'מתי נתפס';
COMMENT ON COLUMN core.classification.item_id IS 'הפריט';
COMMENT ON COLUMN core.classification.model IS 'המודל שסיווג, למשל nova-lite או haiku';
COMMENT ON COLUMN core.classification.prompt_version IS 'גרסת הפרומפט, כדי שאפשר יהיה להשוות לפני ואחרי שינוי';
COMMENT ON COLUMN core.classification.relevance IS 'עד כמה הפריט רלוונטי לנושאים במעקב, בין 0 ל-1';
COMMENT ON COLUMN core.classification.misinfo_score IS 'הערכת המודל לסבירות שהפריט מכיל מידע כוזב, בין 0 ל-1';
COMMENT ON COLUMN core.classification.sentiment IS 'הסנטימנט של הפריט';
COMMENT ON COLUMN core.classification.summary_en IS 'תקציר קצר באנגלית, לקריאה מהירה בלי תרגום';
COMMENT ON COLUMN core.classification.classified_at IS 'מתי סווג';
COMMENT ON COLUMN core.item_topic.item_id IS 'הפריט';
COMMENT ON COLUMN core.item_topic.topic_id IS 'הנושא מרישום המקורות';
COMMENT ON COLUMN core.item_topic.score IS 'עד כמה הפריט שייך לנושא, בין 0 ל-1';
COMMENT ON COLUMN core.embedding.item_id IS 'הפריט';
COMMENT ON COLUMN core.embedding.model IS 'מודל ה-embedding. שני הווקטורים באותה שורה מאותו מודל, כדי שאפשר יהיה להשוות ביניהם';
COMMENT ON COLUMN core.embedding.content_vec IS 'הווקטור של content_text, לחיפוש סמנטי, היברידי ולקלאסטרים';
COMMENT ON COLUMN core.embedding.title_vec IS 'הווקטור של title, רק לפריטים עם כותרת (חדשות, Reddit, YouTube). מאפשר להתאים כותרות שמספרות את אותו סיפור גם כשגוף הכתבה שונה';
COMMENT ON COLUMN core.embedding.embedded_at IS 'מתי חושבו הווקטורים';
COMMENT ON COLUMN core.entity.entity_id IS 'מזהה הישות';
COMMENT ON COLUMN core.entity.type IS 'PER, ORG או LOC';
COMMENT ON COLUMN core.entity.canonical_name IS 'השם הקנוני של הישות, שאליו מאוחדים כל הכתיבים';
COMMENT ON COLUMN core.entity.country IS 'קוד מדינה ISO, למקומות (LOC)';
COMMENT ON COLUMN core.entity.admin1 IS 'מחוז או אזור בתוך המדינה, למקומות';
COMMENT ON COLUMN core.entity.geonames_id IS 'המזהה ב-GeoNames, לאיחוד שמות שונים של אותו מקום';
COMMENT ON COLUMN core.entity.geom IS 'נקודה על המפה, למקומות. נשמרת פעם אחת לכל מקום, וכל פריט וכותב מצביעים עליה';
COMMENT ON COLUMN core.item_entity.item_id IS 'הפריט';
COMMENT ON COLUMN core.item_entity.entity_id IS 'האדם או הארגון. מקומות נכתבים ל-core.item_location ולא לכאן, כדי שמקום לא יקושר פעמיים';
COMMENT ON COLUMN core.item_entity.surface_form IS 'איך הישות נכתבה בפריט עצמו';

COMMENT ON COLUMN core.reality.reality_id IS 'Nonnegative ID. Seed 0 = Real world; explicitly register simulation runs.';

COMMENT ON COLUMN core.reality.name IS 'Readable reality or exercise name.';

COMMENT ON COLUMN core.reality.description IS 'Optional purpose or scenario description.';

COMMENT ON COLUMN core.reality.created_at IS 'DEFAULT now().';

COMMENT ON COLUMN core.platform.platform IS 'Stable platform code. Seed the ten platforms listed in the HTML.';

COMMENT ON COLUMN core.platform.display_name IS 'Human-readable platform name.';

COMMENT ON COLUMN core.source.platform IS 'Platform registry FK replaces core.platform enum.';

COMMENT ON COLUMN core.source.handle_or_url IS 'Intentional change: NULL if only the native source identity is available.';

COMMENT ON COLUMN core.source.arena IS 'Intentional change: NULL until authoritative registry metadata supplies IL, ARAB or INTL. Never guess.';

COMMENT ON COLUMN core.source.reality_id IS 'DEFAULT 0; FK to reality; scopes identity and mutable metadata.';

COMMENT ON COLUMN core.source.metadata_observed_at IS 'When collector-provided source metadata was measured; guards late count/profile updates independently of updated_at.';

COMMENT ON COLUMN core.author.profile_place_id IS 'Optional composite FK (reality_id, profile_place_id) to entity; LOC-only validation.';

COMMENT ON COLUMN core.author.reality_id IS 'DEFAULT 0; FK to reality; scopes identity and mutable metadata.';

COMMENT ON COLUMN core.author.platform IS 'Explicit platform FK; enables item-author platform consistency.';

COMMENT ON COLUMN core.entity.reality_id IS 'DEFAULT 0; FK to reality; scopes identity and mutable metadata.';

COMMENT ON COLUMN core.item.reality_id IS 'DEFAULT 0; CHECK >= 0; FK to registered reality.';

COMMENT ON COLUMN core.item.platform IS 'Platform registry FK replaces core.platform enum.';

COMMENT ON COLUMN core.item.url IS 'Intentional change: NULL if no legitimate canonical link can be constructed.';

COMMENT ON COLUMN core.item.source_id IS 'Composite FK (reality_id, source_id, platform) to source.';

COMMENT ON COLUMN core.item.author_id IS 'Optional composite FK (reality_id, author_id, platform) to author.';

COMMENT ON COLUMN core.item.dup_of IS 'Composite FK (reality_id, dup_of) to item; no self-reference; same-reality root only.';

COMMENT ON COLUMN core.item.last_seen_at IS 'Latest observed collection time; never decreases; index/update metadata only.';

COMMENT ON COLUMN core.item.current_event_id IS 'Composite FK with reality_id to ingest_events; identifies the observation selected for current content and raw_uri.';

COMMENT ON COLUMN core.item.content_revision IS 'DEFAULT 1; positive. Increment when inputs used by enrichment materially change.';

COMMENT ON COLUMN core.engagement_snapshot.provider IS 'Provider that measured these counts; part of snapshot primary key.';

COMMENT ON COLUMN core.topic.topic_id IS 'Stable subject ID, shared taxonomy managed by configuration.';

COMMENT ON COLUMN core.topic.name IS 'For example: politics, economy, security.';

COMMENT ON COLUMN core.topic.description IS 'Definition used by classifiers.';

COMMENT ON COLUMN core.topic.active IS 'DEFAULT true. Disable rather than remove referenced definitions.';

COMMENT ON COLUMN core.item_topic.topic_id IS 'FK to topic registry.';

COMMENT ON COLUMN core.item_topic.content_revision IS 'Positive input revision. Current reads include only rows matching item.content_revision.';

COMMENT ON COLUMN core.collection_query.reality_id IS 'Reality FK; part of composite primary key.';

COMMENT ON COLUMN core.collection_query.query_id IS 'Immutable versioned query ID within a reality.';

COMMENT ON COLUMN core.collection_query.platform IS 'Platform FK.';

COMMENT ON COLUMN core.collection_query.query_text IS 'Actual collector search expression; changing its meaning creates a new query_id.';

COMMENT ON COLUMN core.collection_query.description IS 'Readable purpose.';

COMMENT ON COLUMN core.collection_query.active IS 'DEFAULT true.';

COMMENT ON COLUMN core.item_query_match.query_id IS 'Composite FK (reality_id, query_id) to collection_query; query platform must match item.';

COMMENT ON COLUMN core.item_query_match.reality_id IS 'Composite item and dimension FKs prevent cross-reality links.';

COMMENT ON COLUMN core.item_location.content_revision IS 'Positive input revision. Current reads include only rows matching item.content_revision.';

COMMENT ON COLUMN core.item_location.reality_id IS 'Composite item and dimension FKs prevent cross-reality links.';

COMMENT ON COLUMN core.item_entity.content_revision IS 'Positive input revision. Current reads include only rows matching item.content_revision.';

COMMENT ON COLUMN core.item_entity.reality_id IS 'Composite item and dimension FKs prevent cross-reality links.';

COMMENT ON COLUMN core.classification.content_revision IS 'Positive input revision. Current reads include only rows matching item.content_revision.';

COMMENT ON COLUMN core.embedding.content_revision IS 'Positive input revision. Current reads include only rows matching item.content_revision.';

COMMENT ON COLUMN ingest.ingest_events.event_id IS 'Immutable incoming eventId; global primary key.';

COMMENT ON COLUMN ingest.ingest_events.event_hash IS 'SHA-256 of immutable original event content, independent of normalizer version and S3 destination.';

COMMENT ON COLUMN ingest.ingest_events.schema_version IS 'Input event contract version.';

COMMENT ON COLUMN ingest.ingest_events.reality_id IS 'Validated reality FK; event reality is immutable.';

COMMENT ON COLUMN ingest.ingest_events.observed_at IS 'Collection observation time.';

COMMENT ON COLUMN ingest.ingest_events.ingested_at IS 'DEFAULT now().';

COMMENT ON COLUMN ingest.deliveries.stream_id IS 'Kafka stream incarnation; rotated if topics are recreated.';

COMMENT ON COLUMN ingest.deliveries.topic IS 'Actual Kafka topic.';

COMMENT ON COLUMN ingest.deliveries.partition IS 'CHECK >= 0.';

COMMENT ON COLUMN ingest.deliveries.offset_value IS 'CHECK >= 0.';

COMMENT ON COLUMN ingest.deliveries.event_id IS 'FK to immutable ingestion event.';

COMMENT ON COLUMN ingest.deliveries.raw_uri IS 'Exact archived raw delivery in S3; immutable object with checksum verification.';

COMMENT ON COLUMN ingest.processing_receipts.event_id IS 'FK to ingest_events; part of receipt key.';

COMMENT ON COLUMN ingest.processing_receipts.processor_version IS 'Part of receipt key; controlled reprocessing uses a new version.';

COMMENT ON COLUMN ingest.processing_receipts.reality_id IS 'Must match both event and produced item via composite FKs.';

COMMENT ON COLUMN ingest.processing_receipts.item_id IS 'FK to produced item; initial retention policy keeps referenced items.';

COMMENT ON COLUMN ingest.processing_receipts.processed_at IS 'DEFAULT now(); written in the item transaction.';


DROP TRIGGER delivery_identity ON ingest.deliveries;
CREATE TRIGGER delivery_identity BEFORE UPDATE ON ingest.deliveries FOR EACH ROW
EXECUTE FUNCTION core.immutable_fields('stream_id','topic','partition','offset_value','event_id');
CREATE FUNCTION ingest.check_archive_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.raw_uri IS NOT NULL AND NEW.raw_uri IS DISTINCT FROM OLD.raw_uri THEN
    RAISE EXCEPTION 'An archive link cannot be replaced' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_archive_link BEFORE UPDATE OF raw_uri ON ingest.deliveries
FOR EACH ROW EXECUTE FUNCTION ingest.check_archive_link();
COMMENT ON COLUMN core.item.raw_uri IS 'Nullable until Kafka Connect archive location is resolved for the current event.';
COMMENT ON COLUMN ingest.deliveries.raw_uri IS 'Nullable until the exact Connect object is resolved; once filled it is immutable.';

-- Enrichment orchestration and exact archive record provenance.

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

-- Original raw bytes are also retained for each redelivery.

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

-- Attachment retrieval and local OCR jobs.
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
