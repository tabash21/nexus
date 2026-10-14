# Nexus — Agent Coding Standards & Architecture Guide

Nexus is an OSINT data platform monorepo featuring a high-throughput Kafka ingestion worker, transactional deduplication with PostgreSQL (Artemis schema), an asynchronous job-leased enrichment worker, a local S3 raw archive via Kafka Connect, an authenticated NestJS query API, and a Next.js operational dashboard.

---

## Tech Stack

- **Monorepo & Build Tooling:** Turborepo 2, npm workspaces (Node.js >= 22 / 24, npm 11)
- **Backend Framework:** NestJS 12 (Express adapter for API, standalone application contexts for Worker and Enrichment Worker)
- **Frontend / Telemetry:** Next.js 15, React 19, TailwindCSS, Lucide icons (`apps/dashboard`)
- **Language & Runtime:** TypeScript 5.9 (Strict mode, ESM `NodeNext`, Decorator Metadata enabled)
- **Message Broker & Ingestion:** Apache Kafka 4 (KRaft mode), KafkaJS 2
- **Raw Archive:** Kafka Connect (Confluent S3 sink), LocalStack S3 (AWS SDK / Avro containers via `avsc`)
- **Database & Storage:** PostgreSQL 17 (`pg`, PostGIS, pgvector, pg_trgm), PGlite (`@electric-sql/pglite` for fast in-memory embedded test runs), Drizzle ORM
- **Schema & Validation:** Zod 3, Node.js `crypto` (Canonical JSON serialization + SHA-256)
- **Testing:** Vitest 5

---

## Essential Commands

All commands should be executed from the repository root:

### Development & Build
- `npm run dev:services` — Concurrently runs `@nexus/api`, `@nexus/worker`, and `@nexus/enrichment-worker` in dev watch mode with `tsx watch` (no pre-build needed).
- `npm run dev:api` — Run only the API service in dev watch mode with `tsx watch`.
- `npm run dev:worker` — Run only the Kafka ingestion worker with `tsx watch`.
- `npm run dev:enrichment-worker` — Run only the enrichment worker with `tsx watch`.
- `npm run ui` — Run the Next.js dashboard (`apps/dashboard`) on port 3001.
- `npm run dev` — Run all workspace services concurrently via Turborepo.
- `npm run build` — Build all workspace packages (`turbo run build`).

### Quality & Verification
- `npm run check` — **Run on every code change**: typechecks, tests, runs model checks, and builds all workspace packages.
- `npm run typecheck` — Run TypeScript type checking across monorepo packages and root tools.
- `npm test` — Builds all packages and runs unit/integration tests with Vitest against embedded PGlite.
- `npm run test:integration` — Runs real PostgreSQL concurrency tests (requires `$env:INTEGRATION_DATABASE_URL`).

### Infrastructure & Operations
- `npm run infra:up` — Start local Kafka, PostgreSQL, LocalStack S3, and Kafka Connect (`docker compose up -d --wait`).
- `npm run infra:down` — Stop infrastructure containers and preserve volumes.
- `npm run local:dev` — Starts infrastructure, checks/prepares database, registers connectors/topics, and launches services.
- `npm run topics:setup` — Initialize Kafka topics (`raw.<platform>.v1`, `sim.<platform>.v1` for 10 platforms, and `osint.quarantine.v1`).
- `npm run db:prepare` — Check models, apply migrations, and verify schema against reference DB.
- `npm run db:migrate` — Apply pending PostgreSQL schema migrations.
- `npm run archive:register` — Register the Kafka Connect S3 sink connector.
- `npm run demo:publish` — Publish a demo OSINT event to Kafka.
- `npm run replay -- <path-to-archive.avro> <topic>` — Replay raw events from an Avro archive back into Kafka.

---

## Boundaries & Golden Rules

### Always
- **Run `npm run check`** before concluding any task involving code modifications.
- **Report infrastructure limitations**: If Docker or external infrastructure checks cannot run, explicitly state this to the user.
- **Acknowledge Kafka only after durable persistence**: Commit Kafka offsets only after PostgreSQL transaction commits or after successful publication to the quarantine topic.
- **Preserve idempotency and replay invariants**: Always check `ingest.processing_receipts` and deliveries. Never bypass duplicate detection.
- **Enforce reality separation**: Reality 0 = real-world operational sources; Reality 1 = simulation sources. Reality is worker-assigned based on topic, NEVER supplied in Kafka payloads.
- **Use parameterized SQL**: Never interpolate raw strings into SQL queries. Use parameterized placeholders (`$1`, `$2`, etc.).
- **Synchronize schema changes**: Any changes to database models must update typed Drizzle schemas in `packages/database/src/schema/`, generate migrations, and update `packages/database/src/schema.sql`.
- **Maintain NodeNext ESM imports**: All relative imports in TypeScript source files must use the `.js` extension (e.g. `import { foo } from './foo.js'`).
- **Build before running tests**: The API and worker tests rely on compiled TypeScript artifacts (`dist/`) for decorator metadata and reflection.

### Never
- **Never introduce Fastify**: The NestJS API must use the default Express adapter (`@nestjs/platform-express`).
- **Never introduce or replace major technologies** (frameworks, databases, messaging systems, languages, package managers, test tooling) without explicit user confirmation.
- **Never acknowledge a Kafka message on infrastructure failures**: Database connection drops, broker outages, or transient failures must reject/crash without offset commit so Kafka can retry or restart under supervision.
- **Never mutate or regenerate `eventId` during replay or retry**: `eventId` is globally unique and immutable; altering it breaks idempotency and duplicates records.
- **Never use the `any` type**: Use explicit interfaces/types, generics, or `unknown` with Zod parsing / type guards.
- **Never commit git changes without explicit user approval** for that specific commit.
- **Never modify protected configuration files without asking**: `.env`, `.env.example`, `compose.yaml`.
- **Never use offset-based pagination (`OFFSET ... LIMIT`)** on item listings: use cursor-based keyset pagination with deterministic tie-breakers `(published_at DESC, item_id DESC)`.

### Ask First
- Adding any new npm dependency to any app or package.
- Modifying the core event schema contract (`packages/contracts/src/index.ts`).
- Altering database schema or indexes (`packages/database/src/schema/`).
- Changing Kafka topics, consumer groups, or partitioning logic.
- Modifying root configurations: `turbo.json`, `tsconfig.base.json`, `compose.yaml`.

---

## Monorepo Architecture & Folder Structure Guidelines

Nexus follows a modular monorepo layout using Turborepo and npm workspaces.

### Workspace Top-Level Organization

```text
nexus/
├── apps/
│   ├── api/                  # NestJS REST API (items, sources, authors, queries, stats, health)
│   ├── worker/               # NestJS Kafka ingestion worker (raw/sim topic consumers, adapters)
│   ├── enrichment-worker/    # NestJS enrichment worker (lease-based poller, pluggable processors)
│   └── dashboard/            # Next.js 15 operational dashboard & telemetry UI
├── packages/
│   ├── contracts/            # Schemas, canonical hashing, normalization, topic/platform registries
│   ├── database/             # Drizzle models, migrations, transactional ingest, atomic job queue
│   └── kafka/                # Shared KafkaJS client factory, admin setup, consumer options
├── docs/                     # Central documentation (Getting Started, ERDs, API reference, guides)
├── infra/                    # Infrastructure configs (Dockerfiles, Connect configs, LocalStack S3)
├── scripts/                  # Operational CLI utilities (setup, demo publisher, replay, migration checks)
└── tests/                    # Cross-package test suites (embedded PGlite, integration, lifecycle)
```

---

### Service & Package Archetypes

#### 1. HTTP / REST API Services (`apps/api/`)
API services use NestJS with the default Express adapter, structured by feature or domain:
```text
apps/api/src/
├── index.ts                  # Entry point: environment parsing, bootstrap, shutdown hooks
├── app.ts                    # Application factory: NestFactory.create, Express config, filters
├── app.module.ts             # Root module: registers shared providers, imports domain modules
├── tokens.ts                 # Dependency injection tokens and repository interfaces
├── common/                   # Shared cross-cutting concerns (guards, filters, interceptors)
│   ├── auth.guard.ts         # Constant-time token authentication guard
│   └── http-error.filter.ts  # Sanitized exception filter
└── <feature>/                # Domain feature modules (items, sources, authors, health, etc.)
    ├── <feature>.controller.ts # Route handlers and HTTP status codes
    ├── <feature>.service.ts    # Business orchestration and repository invocation
    ├── <feature>.dto.ts        # Zod request/query validation schemas & types
    └── <feature>.cursor.ts     # Keyset cursor encode/decode
```

#### 2. Kafka Ingestion Worker (`apps/worker/`)
Ingestion worker runs as a standalone NestJS application context (without HTTP):
```text
apps/worker/src/
├── index.ts                  # Standalone Nest context bootstrap & signal handling
├── worker.module.ts          # Root worker module: dynamic provider configuration
├── worker.service.ts         # Multi-platform consumer coordinator, heartbeat & offset management
├── adapters/                 # Ingestion adapters (telegram.v1, provisional.v1)
├── heartbeat.ts              # In-flight heartbeat coordinator
└── process.ts                # Message validation, transactional ingest & quarantine routing
```
- **Guidelines:** Explicit offset control (`autoCommit: false`); heartbeat maintained during persistence; reject unrecoverable errors without commit to trigger retry.

#### 3. Enrichment Worker (`apps/enrichment-worker/`)
Asynchronous post-ingestion processor running as a standalone NestJS application context:
```text
apps/enrichment-worker/src/
├── index.ts                  # Standalone Nest context bootstrapper & CLI dispatcher
├── enrichment.service.ts     # Poller loop: atomic lease claiming, renewal, and shutdown
├── archive/                  # S3 Avro archive verification and byte reconciler
└── processors/               # Pluggable processor registry and implementations
    ├── types.ts              # EnrichmentProcessor, TaskContext, ProcessorResult
    ├── registry.ts           # Central processor registry
    └── implementations/      # Diagnostic, LLM summarization, vector embedding processors
```
- **Guidelines:** Claims jobs using `FOR UPDATE SKIP LOCKED` with leased tokens; heartbeats leases; persists results back to `ingest.enrichment_results`.

#### 4. Storage & Repository Package (`packages/database/`)
Shared database, migration, and persistence logic package:
```text
packages/database/src/
├── index.ts                  # Clean barrel exports of public types, errors, and repositories
├── schema/                   # Drizzle ORM models (base, registry, identity, items, enrichment, ingest)
├── schema.sql                # Declarative PostgreSQL DDL snapshot
├── migrate.ts                # Advisory-locked schema migration runner
├── ingest.ts                 # Transactional multi-table write pipeline
├── jobs.ts                   # Atomic job leasing, renewal, completion, backoff, and retry
└── archive.ts                # Candidate archive lookup and atomic delivery record linking
```

#### 5. Contracts & Shared Utility Package (`packages/contracts/`)
Pure contracts, validation schemas, and deterministic domain helpers:
```text
packages/contracts/src/
├── index.ts                  # Clean barrel exports of schemas, types, and pure helpers
├── schema.ts                 # Zod schema definitions and inferred domain types
├── hash.ts                   # Canonical JSON serialization and SHA-256 hashing
├── sources.ts                # Platform registry, topic mappings, and reality validation
└── normalize.ts              # Domain data normalization and sanitization helpers
```

---

## Ingestion Pipeline & Data Guarantees

### 1. Ingestion Guarantees & Lifecycle
1. **At-Least-Once Delivery with Idempotent Ingestion**:
   - Every Kafka message is consumed with `autoCommit: false`.
   - Message payload is validated against platform adapters (`telegram.v1`, `provisional.v1`) using Zod.
   - If invalid JSON or schema violation: publish to `osint.quarantine.v1` (with base64 original bytes and error reason), then commit offset.
2. **Transactional Database Processing**:
   - `ingest()` executes within a single PostgreSQL transaction (`BEGIN ... COMMIT / ROLLBACK`).
   - Inserts into `ingest.ingest_events` and records raw input snapshots.
   - Verifies event hash: if `eventId` was already used with different payload content, throws `EventConflictError` and quarantines event.
   - Records delivery in `ingest.deliveries` (`stream_id`, `topic`, `partition`, `offset_value`).
   - Checks `ingest.processing_receipts` (`event_id`, `processor_version`). If receipt already exists, marks as `{ duplicate: true }` and commits without reprocessing.
   - Upserts `core.source` and `core.author`.
   - Locks and updates `core.item` (`INSERT ... ON CONFLICT (reality_id, item_id) DO UPDATE`).
   - Saves `core.item_media`, `core.engagement_snapshot`, and query matches.
   - Enqueues required enrichment tasks into `ingest.enrichment_jobs`.
   - Inserts processing receipt and commits transaction.
3. **Kafka Offset Commitment**:
   - Offset `(offset + 1)` is committed **only** after the database transaction commits or quarantine publication completes.
   - Heartbeats are maintained during processing to prevent consumer group rebalance.

### 2. Dual Path Ingestion
- **Operational Path (Worker → PostgreSQL)**: Real-time processing for immediate queryability via NestJS API.
- **Archival Path (Kafka Connect → S3)**: Independent consumer group (`nexus-connect`) archiving raw message bytes into Avro files on S3.
- **Replay**: `npm run replay` replays raw bytes into Kafka with original `eventId`. Ingestion idempotency prevents duplicate items or receipts.

---

## NestJS API & Worker Conventions

### NestJS API (`apps/api`)
- **Express Platform**: Always use default Express adapter (`NestFactory.create` with `disable('x-powered-by')`). Do not use Fastify.
- **Authentication**: `BearerGuard` validates tokens using constant-time comparison (`timingSafeEqual`) to mitigate timing attacks. Tokens must be at least 24 characters.
- **Health Probes**:
  - `GET /health/live`: Process liveness (returns `{ status: 'ok' }`).
  - `GET /health/ready`: Database connectivity check (returns 503 if DB is unreachable or unmigrated; never leaks DB error details).
- **Pagination**:
  - Keyset cursor-based pagination using composite sorting `(published_at DESC, item_id DESC)`.
  - Encode cursors as URL-safe base64 JSON.
  - Return shape: `{ "items": [...], "nextCursor": "..." | null }`.
- **Error Handling**: Use `HttpErrorFilter` to format exceptions uniformly as `{ "error": message }`.

### NestJS Worker (`apps/worker`)
- **Standalone Context**: Initialized with `NestFactory.createApplicationContext` (no HTTP listener).
- **Lifecycle Management**: Implement `OnModuleInit` and `OnApplicationShutdown`.
- **Resource Cleanup**: In `onApplicationShutdown`, disconnect Kafka consumers, producers, and close database pool using `Promise.allSettled`.

---

## Database & Query Guidelines

### Schema Rules
- Use PostgreSQL-native types: `uuid`, `timestamptz`, `jsonb`, `text`, `bigint`, `geography`, `vector`.
- Schemas: `core` (domain entities) and `ingest` (transport, receipts, jobs).
- Composite foreign keys and constraints guarantee relational consistency across realities.
- Keyset index on `(reality_id, published_at DESC, item_id DESC)`.

---

## Testing Standards

### 1. Embedded Testing (Default)
- Use `@electric-sql/pglite` for database tests in `tests/database.test.ts`.
- Fast, self-contained, and runnable without Docker.

### 2. Integration & Concurrency Testing
- `tests/database.integration.test.ts` executes concurrency stress tests against real PostgreSQL.
- Triggered when `INTEGRATION_DATABASE_URL` is defined.

### 3. API & Lifecycle Testing
- `tests/api.test.ts` tests compiled endpoints against real local HTTP sockets.
- Always run `turbo run build` before executing Vitest to ensure compiled decorators match source code.
