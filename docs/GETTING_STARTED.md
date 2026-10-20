# Nexus: Getting Started

## Architecture

Source collectors publish their existing messages to `raw.<platform>.v1` or `sim.<platform>.v1`. The worker archives each exact Kafka delivery to S3 before mapping it. Valid observations go to `items.silver`, keyed by the stable item ID; invalid observations go to the quarantine topic with an archive URI. The enrichment worker consumes silver and writes the PostgreSQL domain tables. It is a database writer in this release; model processors are future work.

Bronze S3 objects are gzip NDJSON. Each line contains the original Kafka topic, partition, offset, timestamp, key, headers, and value bytes encoded as base64. Replaying an object preserves the original observation identity. The mapper includes its exact `s3://` URI and SHA-256 checksum in silver.

PostgreSQL uses `ingest.ingest_events`, deliveries, and processing receipts for replay safety. `core.item` holds the latest content revision. `core.engagement_snapshot` holds one row per distinct event, so equal-time measurements can coexist; `core.item_ds` chooses the latest by capture time and snapshot ID. Raw and simulation sources remain separated by worker-assigned reality IDs.

Native Telegram observations carry their source content version (`contentVersionAt`) separately from collection and engagement time. Older edits, missing edit times after a known edit, and conflicting text at the same edit time preserve current content while still adding engagement history. Legacy Avro replay carries a `legacyReplay` marker through silver so the writer can recover the original identity from its source delivery; fresh observations keep their own identities even when the raw payload is identical.

## News collector input

The worker recognizes RSS collector articles on news subscriptions using the
`news.v1` adapter. Existing `provisional.v1` news events remain supported.
Required fields are `itemId`, `feedUrl`, `link`, and `collectedAt`. Feed and article
URLs must use HTTP or HTTPS. `feedName`, `title`, and `contentSnippet` may be omitted
or null; at least the title or snippet must contain nonblank text. Headline-only
articles have empty body text.
`collectedAt` supplies observation time and must be an ISO timestamp with an
explicit timezone. `isoDate` supplies publication time when present and must also
be a valid ISO timestamp with a timezone; missing, null, or blank values are absent.
Without `isoDate`, a parseable `pubDate` with an explicit timezone supplies publication
time. Otherwise publication time remains unknown, and storage uses its existing
collection-time fallback, marked `collected_at_fallback`.
`creator` or `dc:creator` optionally supplies the author, either as a string or
an XML text node (`{ "_": "Author", "$": { ... } }`). Empty, attribute-only, or
unrecognized author values are ignored, with the other creator field tried next.
The plain-text snippet becomes article text; original HTML remains in bronze.

Feed URL plus collector item ID identifies an article. A supplied UUID `eventId`
is preserved; otherwise the complete raw payload, including collection time,
and worker-assigned reality determine observation identity. Replaying the original payload deduplicates;
a changed payload or collection time produces a new observation of the same item.
Raw payloads must omit `realityId`; source configuration assigns reality.

Default subscriptions already include `raw.news.v1` and `sim.news.v1`. For another
existing topic, configure `KAFKA_SOURCES` with platform `news`, adapter `news.v1`,
the actual topic, its existing consumer group, and the appropriate mode. Both
workers must have matching source subscriptions so silver validation accepts it.

## Run locally

From the repository root, install dependencies and start the local stack:

```powershell
npm ci
npm run local
```

The stack includes PostgreSQL, Kafka, LocalStack S3, API, mapper worker, and silver writer. The API listens on `http://localhost:3000`. Start the dashboard separately with `npm run ui` on port 3001.

To run Node services in watch mode against local infrastructure:

```powershell
npm run infra:up
npm run db:prepare
npm run setup
npm run dev:services
```

Publish a sample with `npm run demo:publish`. Run `npm run check` after code changes. Real PostgreSQL and Kafka/S3 integration tests require their configured infrastructure.

### Keep an existing Kafka connection (including NP port forwarding)

Keep the Kafka settings in your root `.env` and run:

```powershell
npm run local:configured
```

This starts only PostgreSQL and S3 in Docker, builds the workspaces, prepares the
local database, and runs the API and both workers on the host using `.env`.
It preserves the existing consumer groups and does not create Kafka topics.
Unlike `npm run local`, it does not launch a local Kafka broker or replace the
configured broker with the Docker-internal `kafka:29092` address. Keep any NP
Kafka port forwarding running. The configured cluster must already contain the
subscribed raw/simulation topics, silver topic, and quarantine topic.
Each entry in `KAFKA_PLATFORMS` subscribes to both `raw.<platform>.v1` and
`sim.<platform>.v1`. Enable only platforms whose two topics exist on the configured
cluster. A missing source topic aborts the entire mapper startup, including news.
For the current NP topic set, `KAFKA_PLATFORMS=telegram,news` enables the available
pairs. Use explicit `KAFKA_SOURCES` entries if a platform has only a raw topic.

In another terminal, start the dashboard:

```powershell
npm run ui
```

Open <http://localhost:3001>. Use **Items (API Service)** and **View JSON** to
inspect stored records. The dashboard lists the latest 25 items across platforms;
use the news inspector below for a dedicated news view.

### Inspect news records and pipeline progress

```powershell
npm run inspect:news
npm run inspect:news -- --limit 20
```

The report reads missing configured source topics, Kafka topic watermarks, existing consumer-group members and
committed offsets/lag, PostgreSQL news item/receipt/delivery counts, recent full
news rows, authenticated API news results, and S3 bucket readiness. Each failed
stage is reported separately. Offset watermarks describe log positions, not exact
record counts; an uncommitted partition has unknown lag. The command never joins
a consumer group, commits offsets, publishes messages, or writes to PostgreSQL.

Inspect an original archived record using the partition and offset from worker
logs (partition defaults to 0):

```powershell
npm run inspect:news -- --partition 0 --offset 3934
npm run inspect:news -- --archive "s3://nexus-raw/raw/...jsonl.gz#L1"
```

This prints the exact archived delivery, decoded RSS payload, and the current
adapter result or validation reason. It requires an existing S3 archive; it does
not fetch directly from Kafka. Copy an exact archive URI from a stored item's
`raw_uri` or a quarantine record's `rawUri`. To validate a saved collector payload
without infrastructure, run `npm run inspect:news -- --file article.json`.

Fixing the adapter affects new records. Previously quarantined records retain
their committed source offsets; inspect them before deliberately replaying their
bronze archive with the existing replay command. Replay preserves event identity
and the database's duplicate detection.

## Recovery and cutover

`npm run replay -- <archive.jsonl.gz> <raw-topic>` republishes the exact raw bytes from one new bronze object with original transport identity. Legacy `.avro` files remain replayable after Kafka Connect retirement.

For a source-topic cutover, stop the old direct database consumer at its committed offsets, start the updated silver writer on `items.silver`, then start the new worker with the same source consumer groups. When upgrading an existing silver flow, update every writer instance before the mapper: older writers reject the new content-version and legacy-replay metadata. Check S3 archive completeness, source and silver lag, quarantine counts, and database receipts. Kafka Connect is retired from runtime and setup; existing archives and the unused job and archive tables are preserved.
