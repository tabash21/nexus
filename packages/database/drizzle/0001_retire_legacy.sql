-- Explicitly retire the previous database, as approved for the Artemis cutover.
-- A single DROP handles the old circular document/version foreign keys without CASCADE.
DROP TABLE IF EXISTS public.event_documents, public.processing_receipts,
 public.deliveries, public.document_versions, public.documents,
 public.ingest_events, public.sources, public.schema_migrations;
