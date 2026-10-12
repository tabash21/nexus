# Nexus

OSINT data platform MVP. A Turborepo with a NestJS API and NestJS Kafka processing worker, shared event contracts and database code, and a local Kafka → S3 archive path through Kafka Connect.

## Architecture

```mermaid
flowchart LR
    Producers[OSINT producers] --> Kafka[Kafka: osint.raw.v1]
    Kafka -->|Archive consumer group| Connect[Kafka Connect: S3 sink]
    Connect --> Raw[S3 raw archive]
    Kafka -->|Processing consumer group| Worker[NestJS / TypeScript worker]
    Worker -->|Transaction: data + receipt| PG[(PostgreSQL serving DB)]
    Worker -->|Invalid or conflicting event| DLQ[Kafka quarantine topic]
    PG --> API[NestJS / TypeScript API]
    API --> Consumers[Authenticated consumers]
    Raw --> Replay[Controlled replay command]
    Replay --> Kafka
```

The archive and serving paths operate independently. API availability does not imply that an event has already reached S3. This MVP contains the operational path; Python/SQL curated datasets and the analytical warehouse are later additions.

## Repository

```text
apps/api/              NestJS API, controllers, guards and health endpoints
apps/worker/           NestJS application context, Kafka ingestion and quarantine
packages/contracts/    Versioned event schema and stable hashing
packages/database/     PostgreSQL schema, migration, ingestion and queries
infra/connect/         Kafka Connect image and local S3 sink configuration
infra/localstack/      Local S3 emulator and raw bucket initialization
scripts/               Topic setup, demo producer, registration and replay
tests/                 API, acknowledgement, PostgreSQL and concurrency tests
```

## Local run

Requirements: Docker with Compose v2; Node.js 24 and npm 11 for development commands.
Run from the repository root:

```powershell
Copy-Item .env.example .env  # First-time setup only
npm ci
npm run local
```

This starts PostgreSQL, Kafka, local S3, Kafka Connect, the API and the worker.
A one-shot `setup` service applies database migrations, creates Kafka topics and
registers the archive connector before the API and worker start. The API is at
`http://localhost:3000`. The first run builds/downloads the required images.

```sh
npm run local:logs
npm run local:down
```

Shutdown retains PostgreSQL and Kafka volumes. Local S3 is ephemeral. The only
environment file is your private, Git-ignored `.env`; `.env.example` contains local
sample values. Local Compose uses Docker-internal database/broker addresses while
host-side scripts use the localhost addresses from `.env`.

For live editing, `npm run local:dev` stops containerized API/worker processes,
initializes the local infrastructure, and starts Turbo watch on the host. Use this
instead of running a second API/worker alongside the containers.

```sh
npm run demo:publish
```

```powershell
Invoke-RestMethod -Uri http://localhost:3000/v1/documents -Headers @{ Authorization = 'Bearer local-development-token-change-me' }
Invoke-RestMethod -Uri http://localhost:8083/connectors/nexus-raw-s3/status
```

Connector and task statuses should be `RUNNING`. Local S3 is at
`http://localhost:4566`, bucket `nexus-raw`, with credentials `test` / `test`.
Archive files appear under `raw/`, with a 10-second scheduled rotation.

## Deployment building blocks

The repository contains no CI/CD workflows or non-production/production env files.
Any deployment system can build the images and inject its environment variables:

```sh
docker build -f infra/node/Dockerfile -t your-registry/nexus:release .
docker build -f infra/connect/Dockerfile -t your-registry/nexus-connect:release infra/connect
```

The Node image runs the API, worker and setup commands. Images contain compiled
code and production dependencies; environment files are excluded from build contexts.

| File | Purpose |
| --- | --- |
| `compose.yaml` | API, worker, Kafka Connect and setup; uses injected service endpoints |
| `compose.local.yaml` | Adds local PostgreSQL, Kafka and S3, and their internal addresses |
| `infra/node/Dockerfile` | Shared Node runtime image |
| `infra/connect/Dockerfile` | Kafka Connect image with the S3 plugin |

For deployment, inject `NEXUS_IMAGE`, `CONNECT_IMAGE`, `DATABASE_URL`, `API_TOKEN`,
`KAFKA_BROKERS`, `KAFKA_STREAM_ID`, `S3_TARGET=aws`, `S3_BUCKET`, `S3_REGION` and AWS
credentials. Use `NODE_ENV=production` and an environment-specific
`COMPOSE_PROJECT_NAME`. Provide TLS in the PostgreSQL URL and set
`KAFKA_SECURITY_PROTOCOL=SSL` or `SASL_SSL` as required by the Kafka provider.
Topic and Connect replication factors are configurable; set them appropriately for
that cluster. Separate environments should use separate databases/clusters/buckets.

For SASL, inject `KAFKA_SASL_MECHANISM` (PLAIN, SCRAM-SHA-256 or SCRAM-SHA-512),
`KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD`, and `KAFKA_SASL_JAAS_CONFIG` for
Connect's Java clients using the same credentials. TLS uses the runtime's trusted
CAs; private CA/truststore mounts and IAM/OAuth authentication depend on the provider.
Leave `S3_ENDPOINT` empty for AWS and include `AWS_SESSION_TOKEN` for temporary
credentials. Static AWS credentials can be omitted when the Connect runtime has
access to suitable instance-role credentials.

Run on a host with the injected environment and access to the registry/endpoints:

```sh
docker compose -f compose.yaml up -d --no-build --pull always --wait
```

This uses only deployment services; the local infrastructure overlay is not loaded.
No `.env` file is needed on that host. The setup job needs migration/topic-creation
permissions; the API and worker start only after it succeeds. For a new release,
ensure setup runs again (for example with `--force-recreate`) before relying on new
migrations. Keep the API behind an HTTPS ingress; its host binding defaults to
loopback. Secrets, hosting, backups and monitoring belong to the deployment system.

## Event contract

One UTF-8 JSON event per Kafka message. `eventId` is globally unique and must remain unchanged on retries and replay. Key messages by `source.id + ':' + document.externalId` to keep observations of one document in the same partition.

```json
{
  "schemaVersion": 1,
  "eventId": "11111111-1111-4111-8111-111111111111",
  "source": { "id": "example-news", "name": "Example News" },
  "observedAt": "2026-10-11T10:00:00.000Z",
  "document": {
    "externalId": "article-123",
    "url": "https://example.com/article-123",
    "title": "Example article",
    "text": "Collected article text",
    "language": "en",
    "publishedAt": "2026-10-11T09:00:00.000Z",
    "attributes": { "category": "news" }
  }
}
```

Sources may add fields under `document.attributes`; unknown top-level fields are rejected. `language` and `publishedAt` are optional. Kafka transports document payloads, not large media attachments. Attachment collection and storage need an additional producer-side integration.

## Data and delivery guarantees

- A collection event, a document and a content version are distinct records. Recollecting unchanged content preserves the observation while reusing its content version.
- The worker transaction inserts the event, delivery metadata, document/version links and processing receipt together. Kafka acknowledgement happens only after the database commit.
- Duplicate delivery or a crash between database commit and Kafka acknowledgement cannot apply the same event/processor version twice. This is at-least-once delivery with idempotent database processing, not a distributed transaction across Kafka, S3 and PostgreSQL.
- Reusing an event ID for different content is quarantined. `KAFKA_STREAM_ID` distinguishes Kafka clusters/topic incarnations; change it when recreating the source topic or cluster.
- Older observations preserve history without replacing the current document version. Equal observation timestamps keep the first-arriving version. Observation times are normalized to milliseconds.
- Invalid events and identity conflicts are published to the quarantine topic before acknowledgement. Original value/key bytes are represented in base64 there. Database or broker outages fail processing without acknowledging the event; KafkaJS retries/restarts the consumer as applicable, and a terminal consumer failure exits the process for supervision.
- The S3 sink uses a byte-array converter and Avro containers to preserve message value bytes, including malformed JSON. Provenance comes from the event envelope and topic/partition/start-offset object paths. Original Kafka keys, headers and exact per-record transport offsets are not included in this archive configuration; PostgreSQL stores transport offsets for successfully ingested events.
- Development time-based file rotation favors timely visibility and can yield duplicate archived batches after failures. Replay is deduplicated by event ID. Configure and test deterministic rotation before claiming exactly-once S3 output.

```mermaid
erDiagram
    SOURCES ||--o{ INGEST_EVENTS : supplies
    INGEST_EVENTS ||--o{ DELIVERIES : delivered_as
    INGEST_EVENTS ||--o{ PROCESSING_RECEIPTS : processed_by
    SOURCES ||--o{ DOCUMENTS : publishes
    DOCUMENTS ||--o{ DOCUMENT_VERSIONS : has
    INGEST_EVENTS ||--o{ EVENT_DOCUMENTS : produces
    DOCUMENT_VERSIONS ||--o{ EVENT_DOCUMENTS : observed_as
```

## API

| Endpoint | Behavior |
| --- | --- |
| `GET /health/live` | Process liveness; unauthenticated |
| `GET /health/ready` | Database reachable and migrated; unauthenticated, returns 503 otherwise |
| `GET /v1/documents` | Latest document versions, newest observation first |
| `GET /v1/documents/:id` | Current version and document provenance |

The API uses NestJS with its default Express adapter. The worker uses a standalone NestJS application context with startup/shutdown hooks; KafkaJS retains explicit offset control. Document routes require `Authorization: Bearer <API_TOKEN>`. The token must contain at least 24 characters. List parameters: `limit` (1–100, default 25), `source`, `from` (inclusive observation timestamp), `to` (exclusive), and `cursor`. Response shape: `{ "items": [...], "nextCursor": "..." }`. Keep the same filters between pages. Pagination is a live view, not a snapshot: concurrent updates can move documents between pages. Response fields use database-style snake_case.

## Replay

Download an `.avro` object from the raw bucket, then:

```sh
npm run replay -- ./downloaded-archive.avro
```

This republishes original value bytes to the incoming topic with the original event IDs. It also produces new archive observations. Replay files in a controlled window and monitor lag. Do not change event IDs to force reprocessing. A deliberate transformation upgrade requires changing the processor version and a planned backfill; it is not performed automatically by this command.

## Verification

```sh
npm run check
```

This typechecks, tests and builds all packages. HTTP tests exercise the compiled NestJS API over real local HTTP requests, and worker lifecycle tests verify startup/shutdown cleanup. Default tests run SQL against embedded PostgreSQL (PGlite), without Docker. They cover duplicate delivery, preserved observations, out-of-order versions, transaction rollback, API auth/cursors, and acknowledgement/quarantine failures.

For the real-server concurrency test, use a disposable development database with permission to create a temporary schema:

```powershell
$env:INTEGRATION_DATABASE_URL = 'postgresql://nexus:nexus_local@localhost:5432/nexus'
npm run test:integration
```

The test creates and removes only its randomly named test schema. Any CI system can run these same verification commands. Kafka/S3/Connect runtime integration requires a local Compose smoke test; it is not covered by the embedded database tests.

## Deployment boundaries

This is a development foundation. The local Compose overlay uses one Kafka broker, local credentials, plaintext networking and an ephemeral S3 emulator. Production needs managed or durable infrastructure, TLS/SASL for Kafka, separate least-privilege database roles, secret management, S3 lifecycle policies, backup/restore procedures, consumer-lag and data-quality monitoring, and a process supervisor. Replace the local connector endpoint/credentials with your S3 configuration and review the selected connector's license. The API and worker can be built and started independently with their workspace scripts.
