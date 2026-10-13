CREATE TABLE sources (
  id text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE ingest_events (
  id uuid PRIMARY KEY,
  source_id text NOT NULL REFERENCES sources(id),
  event_hash text NOT NULL,
  schema_version integer NOT NULL,
  observed_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);
CREATE TABLE deliveries (
  stream_id text NOT NULL,
  topic text NOT NULL,
  partition integer NOT NULL,
  offset_value bigint NOT NULL,
  event_id uuid NOT NULL REFERENCES ingest_events(id),
  PRIMARY KEY (stream_id, topic, partition, offset_value)
);
CREATE TABLE documents (
  id uuid PRIMARY KEY,
  source_id text NOT NULL REFERENCES sources(id),
  external_id text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  current_version_id uuid,
  UNIQUE (source_id, external_id)
);
CREATE TABLE document_versions (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id),
  content_hash text NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  text text NOT NULL,
  language text,
  published_at timestamptz,
  attributes jsonb NOT NULL,
  UNIQUE (document_id, content_hash),
  UNIQUE (document_id, id)
);
ALTER TABLE documents ADD CONSTRAINT current_version_belongs_to_document
  FOREIGN KEY (id, current_version_id) REFERENCES document_versions(document_id, id);
CREATE TABLE event_documents (
  event_id uuid NOT NULL REFERENCES ingest_events(id),
  document_version_id uuid NOT NULL REFERENCES document_versions(id),
  processor_version text NOT NULL,
  PRIMARY KEY (event_id, processor_version)
);
CREATE TABLE processing_receipts (
  event_id uuid NOT NULL REFERENCES ingest_events(id),
  processor_version text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, processor_version)
);
CREATE INDEX documents_listing ON documents(last_seen_at DESC, id DESC);
CREATE INDEX documents_source_listing ON documents(source_id, last_seen_at DESC, id DESC);
CREATE INDEX event_documents_version ON event_documents(document_version_id);
CREATE INDEX deliveries_event ON deliveries(event_id);
