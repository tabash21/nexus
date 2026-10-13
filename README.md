# Nexus

OSINT data platform MVP. A Turborepo with a NestJS API and NestJS Kafka processing worker, shared event contracts and database code, and a local Kafka → S3 archive path through Kafka Connect.

## Architecture

```mermaid
flowchart LR
    Producers[OSINT producers] --> Kafka[Kafka: per-platform topics]
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

For live editing on your computer without containerizing the Node services:
- `npm run dev:services` — Runs both the API and Kafka worker concurrently with `tsx watch` (hot-reloads on file changes without build steps, reading connection config from `.env`).
- `npm run dev:api` — Runs only the NestJS API with `tsx watch`.
- `npm run dev:worker` — Runs only the Kafka ingestion worker with `tsx watch`.
- `npm run infra:up` — Starts backing infrastructure containers (PostgreSQL, Kafka, LocalStack S3, Connect) once and ensures containerized API/worker instances are stopped to avoid port/group collisions.
- `npm run setup` — Applies database migrations, initializes Kafka topics, and registers the S3 sink connector using `.env`.
- `npm run local:dev` — Combines `infra:up`, `db:prepare`, `setup`, and `dev:services` in a single command.

When pointing `.env` to external/cloud services (e.g. AWS RDS, Neon, Confluent Cloud, Upstash), you do not need Docker at all: simply run `npm run dev:services` (or `npm run dev:api` / `npm run dev:worker`).

```sh
npm run demo:publish
```

```powershell
Invoke-RestMethod -Uri http://localhost:3000/v1/items -Headers @{ Authorization = 'Bearer local-development-token-change-me' }
Invoke-RestMethod -Uri http://localhost:8083/connectors/nexus-raw-s3/status
```

Connector and task statuses should be `RUNNING`. Local S3 is at
`http://localhost:4566`, bucket `nexus-raw`, with credentials `test` / `test`.
Archive files appear under `raw/`, with a 10-second scheduled rotation.

## Deployment building blocks

The CI workflow verifies models, migrations, live schema equivalence and PostgreSQL concurrency. Deployment remains environment-specific.
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

Provide TLS in the deployment PostgreSQL URL and set
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

Most settings have defaults and do not need to be supplied. `.env.example` contains
local source settings plus the host database URL, API token, host broker addresses and
Kafka stream identity. Local Compose supplies the emulator credentials and internal
addresses. Image versions, port numbers, topic names and group names are optional
overrides; leaving them out uses the existing defaults.

For deployment, the values that normally differ by environment are:

| Values | Needed when |
| --- | --- |
| `DATABASE_URL`, `API_TOKEN`, `KAFKA_BROKERS`, `KAFKA_STREAM_ID` | Always; the database URL includes its credentials and TLS options |
| `NEXUS_IMAGE`, `CONNECT_IMAGE` | Pulling your release images from a registry |
| `S3_BUCKET`, `S3_REGION` | AWS archive destination; deployment Compose defaults to AWS |
| AWS credentials | Unless Connect can obtain credentials from its host's AWS role |
| Kafka TLS/SASL settings | As required by your Kafka provider |
| Topic and Connect replication factors | When creating topics on a replicated cluster; defaults are 1 |

The deployment system supplies these at runtime. Regular configuration such as
endpoints/image references can be ordinary deployment variables; API tokens,
passwords and access keys come from secret storage. Build/test jobs do not need
production credentials. `NODE_ENV` already defaults to `production` in deployment
Compose and the runtime image. Use a distinct Compose project name per environment.

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

## Scripts

All current scripts have callers. Demo and replay are manual commands; they are
retained because they serve distinct testing and recovery purposes. npm command
names stay the same after organizing the files:

```text
scripts/
  build/copy-schema.mjs
  setup/index.mjs
  setup/topics.mjs
  setup/register-archive.mjs
  demo/publish.ts
  maintenance/replay.ts
  lib/archive-config.mjs
  lib/kafka-client.mjs
  lib/kafka-client.d.mts
```

| File | What it does | Called by |
| --- | --- | --- |
| `build/copy-schema.mjs` | Copies the SQL schema into the compiled database package; TypeScript does not copy SQL files | Database package build |
| `setup/index.mjs` | Runs database migrations, topic creation and archive registration in sequence | Compose's one-shot setup container |
| `setup/topics.mjs` | Creates incoming/quarantine Kafka topics if absent; does not alter existing topics | Startup and `npm run topics:setup` |
| `setup/register-archive.mjs` | Sends the S3 sink configuration to Kafka Connect's REST API | Startup and `npm run archive:register` |
| `demo/publish.ts` | Produces a sample article event to exercise ingestion | `npm run demo:publish` |
| `maintenance/replay.ts` | Reads an Avro archive and republishes original bytes/event IDs for recovery | `npm run replay -- path/to/archive.avro raw.telegram.v1` |
| `lib/archive-config.mjs` | Builds and validates local/AWS connector settings | Archive registration and tests |
| `lib/kafka-client.mjs` | Creates KafkaJS clients with common broker/TLS/SASL configuration | Worker, topics, demo, replay and tests |
| `lib/kafka-client.d.mts` | Type declarations for the JavaScript Kafka helper; no executable behavior | TypeScript compilation |

## Artemis item schema

The database uses Drizzle ORM with 19 tables, including `reality`, observations,
items, media, engagement and future enrichment. All 123 original HTML columns are
retained. See the [rendered ERDs and migration guide](docs/database/README.md),
[full-column diagram](docs/database/erd.md), and [ingestion flow](docs/plans/item-ingestion.md).
The approved cutover migration removes the old public document tables.

## Provisional input contract

The incoming collector payload is not finalized. `provisional.v1` is a replaceable
adapter for demos/tests; add provider adapters without changing the transaction writer.
Each message contains one observation with an immutable collector-generated event ID.

```json
{
  "schemaVersion": "provisional.v1",
  "eventId": "11111111-1111-4111-8111-111111111111",
  "platform": "telegram",
  "collector": "telegram-collector",
  "provider": "example-provider",
  "observedAt": "2026-10-13T10:00:00Z",
  "source": { "id": "channel-123", "kind": "channel", "name": "Example" },
  "item": { "nativeId": "42", "text": "Example #OSINT message" }
}
```

Optional author/profile fields, publication/edit times, hashtags, mentions, links,
media and engagement are validated in `packages/contracts/src/schema.ts`.
`item.extra` carries additional provider metadata. Missing values do not become
invented counts, classifications or detected language. Embeddings remain future work.

## Topics and delivery guarantees

`KAFKA_PLATFORMS` controls the platform registry (Telegram, X and eight other
platforms by default). Each has a `raw.<platform>.v1` topic and its own consumer
group. `KAFKA_SOURCES` can override topic/group/adapter configuration; the same
registry drives topic setup, worker construction and Connect subscriptions.
Kafka messages omit `realityId`. The worker assigns reality 0 to real sources.
For simulation, register reality 1 first and set `KAFKA_SIMULATION_ENABLED=true`.
This creates `sim.<platform>.v1` topics and separate consumer groups, with reality 1
assigned by default. `KAFKA_SIMULATION_REALITY_ID` can select another registered
positive ID. Custom `KAFKA_SOURCES` entries can override `realityId`; real entries
default to 0 and simulation entries to 1. A separate exercise should use a distinct
custom topic/group and retain its mapping for replay.
The worker checks registration before consuming and rejects `realityId` in the
collector payload so that messages cannot choose their database reality.

- Drizzle saves events, deliveries, dimensions, items, measurements and receipts in
  one transaction. Kafka is acknowledged only after commit or durable quarantine publication.
- Replays preserve event IDs. Different bytes with the same parsed JSON have the same
  canonical hash; reusing an ID for different payload content is a conflict.
- Telegram item identity includes the channel. Reality, platform and native identity
  determine a stable item ID. Producers should use `itemIdentity(event).itemId` as the key.
- Older/equal-time observations do not replace current state. Missing metadata does
  not clear known values. Full media replacement requires `mediaComplete: true`.
- Database/broker failures remain unacknowledged. Heartbeats continue during persistence.
- Kafka Connect is the sole S3 writer and operates independently. Postgres stores
  transport coordinates immediately; `raw_uri` remains NULL pending a future resolver.
- Connect preserves value bytes in Avro, including malformed JSON. Keys/headers and
  exact per-record offsets are not stored inside that archive format. Scheduled
  rotation may duplicate batches after failures; event receipts protect replay.
- Change `KAFKA_STREAM_ID` when recreating a source cluster/topic incarnation.

## API

| Endpoint | Behavior |
| --- | --- |
| `GET /health/live` | Process liveness |
| `GET /health/ready` | Database/schema readiness |
| `GET /v1/items` | Current items, ordered by publication time and item ID |
| `GET /v1/items/:id` | Item, media, latest engagement and current enrichment |

Item routes require `Authorization: Bearer <API_TOKEN>`. List filters are
`realityId` (default 0), `platform`, `source`, `from`, `to`, `limit` (1–100)
and `cursor`. Detail requests also accept `realityId`. Dates filter publication time.
Cursors are bound to their filters. Responses use snake_case fields and decimal
strings for bigint values. Pagination is live; it is not a historical snapshot.

## Replay and verification

```sh
npm run replay -- ./downloaded-archive.avro raw.telegram.v1
npm run check
npm run db:prepare
```

Replay requires the original registered topic and its original reality configuration,
and preserves bytes/event IDs.
`db:prepare` checks model migrations, applies them, and compares the live schema
with a fresh reference database. The reference requires CREATEDB or an explicitly
provided `SCHEMA_REFERENCE_DATABASE_URL`; the target schema is not changed by verification.

```powershell
$env:INTEGRATION_DATABASE_URL = 'postgresql://nexus:nexus_local@localhost:5432/nexus'
npm run test:integration
# With local Kafka/S3/Connect already configured:
$env:RUN_PIPELINE_INTEGRATION = 'true'
npm run test:integration
```

Real-server tests create and remove randomly named databases. The optional pipeline
test consumes Telegram/X through the real worker, verifies replay deduplication,
and finds the unchanged original bytes in Connect's S3 archive. It publishes test
messages on the configured local raw topics and removes its test consumer groups.

To test worker-assigned realities on another broker, set `REALITY_KAFKA_BROKERS`
alongside `INTEGRATION_DATABASE_URL` and run `npm run test:integration`. That test
uses temporary topics/groups and a disposable database, verifies realities 0 and 1
with payloads that omit `realityId`, and cleans up its resources afterward.

Local Compose is a development stack. Production deployment still needs durable
services, access control, secrets, backups and monitoring appropriate to its environment.
