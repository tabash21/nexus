# Nexus: Getting Started

## Architecture

Source collectors publish their existing messages to `raw.<platform>.v1` or `sim.<platform>.v1`. The worker archives each exact Kafka delivery to S3 before mapping it. Valid observations go to `items.silver`, keyed by the stable item ID; invalid observations go to the quarantine topic with an archive URI. The enrichment worker consumes silver and writes the PostgreSQL domain tables. It is a database writer in this release; model processors are future work.

Bronze S3 objects are gzip NDJSON. Each line contains the original Kafka topic, partition, offset, timestamp, key, headers, and value bytes encoded as base64. Replaying an object preserves the original observation identity. The mapper includes its exact `s3://` URI and SHA-256 checksum in silver.

PostgreSQL uses `ingest.ingest_events`, deliveries, and processing receipts for replay safety. `core.item` holds the latest content revision. `core.engagement_snapshot` holds one row per distinct event, so equal-time measurements can coexist; `core.item_ds` chooses the latest by capture time and snapshot ID. Raw and simulation sources remain separated by worker-assigned reality IDs.

Native Telegram observations carry their source content version (`contentVersionAt`) separately from collection and engagement time. Older edits, missing edit times after a known edit, and conflicting text at the same edit time preserve current content while still adding engagement history. Legacy Avro replay carries a `legacyReplay` marker through silver so the writer can recover the original identity from its source delivery; fresh observations keep their own identities even when the raw payload is identical.

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

## Recovery and cutover

`npm run replay -- <archive.jsonl.gz> <raw-topic>` republishes the exact raw bytes from one new bronze object with original transport identity. Legacy `.avro` files remain replayable after Kafka Connect retirement.

For a source-topic cutover, stop the old direct database consumer at its committed offsets, start the updated silver writer on `items.silver`, then start the new worker with the same source consumer groups. When upgrading an existing silver flow, update every writer instance before the mapper: older writers reject the new content-version and legacy-replay metadata. Check S3 archive completeness, source and silver lag, quarantine counts, and database receipts. Kafka Connect is retired from runtime and setup; existing archives and the unused job and archive tables are preserved.
