# Ingestion and enrichment foundation

## What runs today

Kafka delivers the unchanged Telegram message JSON to `apps/worker`. The worker
adapts it, commits the item, raw delivery bytes, current input snapshot, receipt,
and eligible PostgreSQL jobs in one transaction, then commits the Kafka offset.
The item is queryable immediately. Infrastructure failures leave the offset
uncommitted; invalid input is acknowledged only after quarantine publication.

`apps/enrichment-worker` claims committed jobs with `FOR UPDATE SKIP LOCKED`,
claim tokens and expiring leases. It reads its input from PostgreSQL. Its
`test.v1` processor is **only a lifecycle diagnostic**: it records input
provenance and produces no classification, summary, entity, embedding, or other
text analysis. The item API presents its output as `diagnostic`, with `result`
null. Production text processors can be registered in the existing enrichment
worker and scheduled against the same text/title revision, then backfilled for
current items. There is no production analysis processor in this release.

Kafka Connect independently consumes the raw topic into versioned S3 Avro
objects. The enrichment worker later verifies each archived record's exact
bytes and SHA-256 against the PostgreSQL delivery snapshot before recording
the object key, version ID, record position, and `raw_uri`. A mismatch remains
unlinked. The URI fragment identifies a record inside an Avro object. Archive
lag or S3 unavailability does not block item ingestion or enrichment jobs.
The raw bucket must have versioning enabled; LocalStack initializes it.

## Telegram identity and order

The collector sends no `eventId`, `observedAt`, or `mediaReferences`. The
adapter derives a stable UUID from the source/message identity and canonical
raw JSON hash. Exact replays, including historical Avro replay, have the same
ID; any changed JSON value has a different ID. JSON whitespace and object key
order are canonicalized, so formatting-only byte differences are one logical
observation, while exact delivery bytes remain separately archived. For
payloads ingested before this change, a matching stored event hash and item
identity resolves to the original
event ID, preserving its receipt and immutable history. Explicit event IDs in
other supported payloads remain immutable and conflict if reused with different
content. Kafka offsets and broker timestamps never establish observation order.

Telegram `date` is publication time. Without collector observation time,
`editDate` is the only reliable order for text edits: a strictly later value
may replace current text/title. A strictly earlier value cannot. Equal edit
times preserve the first stored text, even when bytes differ. Without
`editDate`, a changed observation has only publication time, so changed text
cannot safely supersede an existing observation at that time. A later edited
observation also cannot be superseded by a payload lacking `editDate`.
Engagement-only observations still have durable raw delivery snapshots and
receipts, but equal-time counters cannot be reliably ordered or represented
as a later point-in-time engagement snapshot. A collector observation time
would be needed to establish that ordering.

Text or title changes increment `core.item.content_revision` and queue a new
text job. Views, forwards, replies, reactions, and media metadata changes do
not invalidate text results. Current API reads require the matching content
revision; enrichment results also require the job's input hash and successful
status. Job rows retain processor version, event ID, input hash, and revision.
Older claims cannot publish after a revision change or an expired lease.

The Telegram adapter continues to store available media metadata in
`core.item_media`. It has no retrievable file reference, so no media job or
Telegram downloader runs. `core.item_media.s3_uri`, OCR, and transcript columns
remain available. A future source adapter can provide a retrievable reference
and register an appropriate source-specific processor once its format and
access method are known; the raw archive is a separate concern.

## Operations

After migration, from the repository root:

```text
node apps/enrichment-worker/dist/index.js stats
node apps/enrichment-worker/dist/index.js retry JOB_ID
node apps/enrichment-worker/dist/index.js backfill JOB_TYPE PROCESSOR_VERSION
```

Manual retry accepts failed jobs only at the current item revision. Backfill
is idempotent per item, revision, job type, and processor version. The current
item must have an input snapshot; exact historical replay can create one for
pre-foundation receipts. Claims, retries, and completion are fenced by the
lease token and current revision. `ENRICHMENT_CONCURRENCY` bounds workers from
1 to 32. Archive reconciliation runs on its own timer.
