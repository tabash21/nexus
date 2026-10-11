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

## Local setup

Requirements: Node.js 24, npm 11, Docker with Compose v2. Run all commands from the repository root. Docker runs Kafka, PostgreSQL, S3 and Kafka Connect; Turbo starts the two application services together.

```sh
npm ci
```

Create `.env` from `.env.example`:

```powershell
# PowerShell
Copy-Item .env.example .env
```

```sh
# macOS / Linux
cp .env.example .env
```

Then initialize infrastructure and start the applications:

```sh
npm run infra:up
npm run topics:setup
npm run db:migrate
npm run archive:register
npm run dev
```

`npm run dev` uses Turbo watch to build each service and its shared dependencies, then runs the API and worker concurrently. Changes rebuild the affected packages and restart the affected services. TypeScript compilation emits the decorator metadata used by NestJS. Use `npm run dev -- --filter=@nexus/api` to run just the API.

In another terminal:

```sh
npm run demo:publish
```

Call the API using the token from `.env`:

```sh
curl -H "Authorization: Bearer local-development-token-change-me" http://localhost:3000/v1/documents
```

PowerShell alternative:

```powershell
Invoke-RestMethod -Uri http://localhost:3000/v1/documents -Headers @{ Authorization = 'Bearer local-development-token-change-me' }
```

Check connector tasks, not only the Connect server's health:

```sh
curl http://localhost:8083/connectors/nexus-raw-s3/status
```

The connector and its tasks should report `RUNNING`. Local S3 uses `http://localhost:4566`, region `us-east-1`, access key `test`, secret `test`, and bucket `nexus-raw`. For example, with the AWS CLI:

```powershell
$env:AWS_ACCESS_KEY_ID = 'test'
$env:AWS_SECRET_ACCESS_KEY = 'test'
aws --endpoint-url http://localhost:4566 --region us-east-1 s3 ls s3://nexus-raw/raw/ --recursive
```

`npm run infra:down` stops the infrastructure and retains the Kafka/PostgreSQL volumes. The local S3 emulator is ephemeral; use real S3 for retained archives. Wait for archival before inspecting objects: the development connector rotates files on a 10-second schedule.

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

## Verification and CI

```sh
npm run check
```

This typechecks, tests and builds all packages. HTTP tests exercise the compiled NestJS API over real local HTTP requests, and worker lifecycle tests verify startup/shutdown cleanup. Default tests run SQL against embedded PostgreSQL (PGlite), without Docker. They cover duplicate delivery, preserved observations, out-of-order versions, transaction rollback, API auth/cursors, and acknowledgement/quarantine failures.

For the real-server concurrency test, use a disposable development database with permission to create a temporary schema:

```powershell
$env:INTEGRATION_DATABASE_URL = 'postgresql://nexus:nexus_local@localhost:5432/nexus'
npm run test:integration
```

The test creates and removes only its randomly named test schema. GitHub Actions runs checks and this concurrency test with PostgreSQL. Kafka/S3/Connect runtime integration requires a local Compose smoke test; it is not covered by the embedded database tests.

## Deployment boundaries

This is a development foundation. The Compose configuration uses one Kafka broker, local credentials, plaintext networking and an ephemeral S3 emulator. Production needs managed or durable infrastructure, TLS/SASL for Kafka, separate least-privilege database roles, secret management, S3 lifecycle policies, backup/restore procedures, consumer-lag and data-quality monitoring, and a process supervisor. Replace the local connector endpoint/credentials with your S3 configuration and review the selected connector's license. The API and worker can be built and started independently with their workspace scripts.
