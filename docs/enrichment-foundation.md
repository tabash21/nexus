# Legacy Ingestion and Enrichment Foundation

> Historical reference: this document describes the former PostgreSQL job and Kafka Connect design. Connect is retired from runtime and setup. The active service consumes `items.silver`, writes PostgreSQL, extracts local entity mentions, and runs the separate [attachment OCR pipeline](media-ocr.md). Existing archives remain replayable. See [Getting Started](GETTING_STARTED.md) for the current flow.

## Overview & Medallion Architecture

Nexus organizes OSINT intelligence into three distinct medallion layers:

1. **Bronze Layer (Raw Transport & Archives)**:
   - Kafka topics receive raw platform payloads (e.g., `raw.telegram.v1`, and future topics such as Twitter/X, Discord, RSS).
   - `ingest.delivery_snapshots` retains exact raw delivery bytes and SHA-256 digests.
   - `ingest.input_snapshots` preserves raw parsed JSON and input hashes.
   - Kafka Connect independently streams raw topic bytes to versioned S3 Avro objects.

2. **Silver Layer (Normalized Canonical Domain)**:
   - Source adapters in `apps/worker` adapt platform-specific schemas into canonical `OsintEvent` / `core.item` records.
   - Deduped and relationally structured: `core.item`, `core.item_media`, `core.source`, `core.author`.
   - Items are immediately queryable via the NestJS API with sub-second ingestion latency.

3. **Gold Layer (Enrichment, Analytics & Vectors)**:
   - `apps/enrichment-worker` asynchronously claims jobs from `ingest.enrichment_jobs` using `FOR UPDATE SKIP LOCKED` with expiring lease tokens.
   - Standardized `ProcessorRegistry` executes modular, pluggable processors.
   - Outputs are stored in `ingest.enrichment_results` and can project into relational gold models (`core.classification`, `core.embedding`, `core.item_entity`, `core.item_location`, `core.item_topic`).

---

## Multi-Topic Readiness & Silver Layer Consumption

### Why Enrichment is Topic-Agnostic
In previous iterations, enrichment jobs only exposed the raw platform payload, requiring processors to be tightly coupled to Telegram-specific MTProto JSON.

In the refactored architecture:
- Every claimed job provides normalized **Silver Layer** fields (`title`, `content_text`, `lang`, `url`, `platform`, `published_at`, `source_id`, `author_id`).
- Semantic processors (LLM summarization, sentiment analysis, translation, topic categorization, vector embeddings) consume `context.item.text` and `context.item.title`. **They work seamlessly across all current and future topics without knowing or caring about the source topic's raw format.**
- Source-specific processors (e.g. platform media token downloaders or telegram entity decoders) still have full access to `context.raw.payload` and `context.raw.bytes`.

---

## Enrichment Worker Architecture

```text
apps/enrichment-worker/
├── src/
│   ├── index.ts                     # CLI dispatcher or Nest application context bootstrapper
│   ├── cli.ts                       # Administrative CLI (stats, retry, backfill)
│   ├── enrichment.module.ts         # NestJS dependency injection module
│   ├── enrichment.service.ts        # Silver consumer & transactional writer
│   ├── enrichment.tokens.ts         # Dependency injection tokens
│   ├── enrichment.resources.ts      # Pool, Kafka, and readiness resources
│   ├── resources.ts                 # Compatibility re-export shim
│   ├── silver.validator.ts          # Kafka message validation & quarantine
│   ├── heartbeat.ts                 # Compatibility shim to @nexus/kafka
│   ├── archive/                     # S3 Avro archive verification
│   │   ├── coordinates.ts           # Pure parser for Connect S3 object naming conventions
│   │   ├── reconciler.ts            # S3 object streamer & byte parity verifier
│   │   └── index.ts
│   └── processors/                  # Pluggable enrichment pipeline
│       ├── types.ts                 # EnrichmentProcessor, EnrichmentTaskContext, ProcessorMetadata
│       ├── registry.ts              # Central processor registry
│       ├── implementations/         # Modular processor implementations
│       │   └── diagnostic.processor.ts # test.v1 lifecycle diagnostic
│       └── index.ts
```

### Persistence Boundary Enforcement
All database queries are maintained in `@nexus/database`:
- `packages/database/src/jobs/` (with `jobs.ts` compatibility shim): Atomic job claiming (`claimJobs`), lease renewal (`renewJob`), fenced result completion (`completeJob`), failure backoff (`failJob`), retry (`retryJob`), and idempotent backfill (`backfillProcessor`).
- `packages/database/src/archive.ts`: Candidate querying (`findUnlinkedArchiveCandidates`) and atomic record linking (`linkArchiveRecord`).

No inline SQL queries live inside application service or archive worker files.

---

## How to Add a New Enrichment Process

Adding a new enrichment processor is designed to be as simple as three steps:

### 1. Implement the Processor
Create `apps/enrichment-worker/src/processors/implementations/my-processor.ts`:

```typescript
import type { EnrichmentProcessor, EnrichmentTaskContext, ProcessorResult } from '../types.js';

export class SentimentProcessor implements EnrichmentProcessor {
  readonly jobType = 'sentiment';
  readonly version = 'sentiment.v1';
  readonly metadata = {
    jobType: 'sentiment',
    version: 'sentiment.v1',
    name: 'Sentiment Analysis',
    description: 'Scores text sentiment from -1.0 to 1.0',
    target: 'text' as const,
  };

  async process(context: EnrichmentTaskContext): Promise<ProcessorResult> {
    // Topic-agnostic: works for Telegram, Twitter, Discord, RSS, etc.
    const text = context.item.text;
    const score = analyzeSentiment(text);

    return {
      values: {
        sentiment: score,
        analyzedAt: new Date().toISOString(),
      },
    };
  }
}
```

### 2. Register the Processor
In `apps/enrichment-worker/src/resources.ts` (or your processor registry configuration):

```typescript
const registry = new ProcessorRegistry([
  testProcessor,
  new SentimentProcessor(),
]);
```

### 3. Schedule & Backfill
- **New Ingested Items**: Ingested automatically when revisions arrive matching registered descriptors in `packages/database/src/ingestion/schedule.ts`.
- **Historical Items**: Run the idempotent backfill CLI command:
  ```bash
  node apps/enrichment-worker/dist/index.js backfill sentiment sentiment.v1
  ```

---

## Archive Reconciliation

Kafka Connect consumes raw topic bytes into versioned S3 Avro objects. The enrichment worker periodically verifies each archived record's exact bytes and SHA-256 against the PostgreSQL delivery snapshot:
1. Scans S3 Avro files in `raw/` matching the naming convention `raw/<topic>/partition=<p>/<topic>+<p>+<offset>.avro`.
2. Decodes raw bytes using `avsc.BlockDecoder`.
3. Verifies byte-level equality and SHA-256 against `ingest.delivery_snapshots`.
4. Records the link in `ingest.archive_links`, `ingest.deliveries.raw_uri`, and `core.item.raw_uri`.
5. Mismatched bytes remain unlinked and flagged.

Archive lag or S3 unavailability does not block real-time item ingestion or enrichment job execution.

---

## Operations CLI

From the repository root:

```bash
# Display summary counts and oldest jobs by status
node apps/enrichment-worker/dist/index.js stats

# Manually retry an exhausted failed job (valid only at the current item revision)
node apps/enrichment-worker/dist/index.js retry <JOB_ID>

# Idempotently schedule a processor backfill across all items at their current revision
node apps/enrichment-worker/dist/index.js backfill <JOB_TYPE> <PROCESSOR_VERSION>
```
