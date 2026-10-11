# Nexus — Agent Coding Standards & Architecture Guide

Nexus is an OSINT data platform monorepo featuring a high-throughput Kafka ingestion worker, transactional deduplication with PostgreSQL, a local S3 raw archive via Kafka Connect, and an authenticated NestJS query API.

---

## Tech Stack

- **Monorepo & Build Tooling:** Turborepo 2, npm workspaces (Node.js >= 22 / 24, npm 11)
- **Backend Framework:** NestJS 12 (Express adapter for API, standalone application context for Worker)
- **Language & Runtime:** TypeScript 5.9 (Strict mode, ESM `NodeNext`, Decorator Metadata enabled)
- **Message Broker & Ingestion:** Apache Kafka 4 (KRaft mode), KafkaJS 2
- **Raw Archive:** Kafka Connect (Confluent S3 sink), LocalStack S3 (AWS SDK / Avro containers via `avsc`)
- **Database & Storage:** PostgreSQL 17 (`pg`), PGlite (`@electric-sql/pglite` for fast in-memory embedded test runs)
- **Schema & Validation:** Zod 3, Node.js `crypto` (Canonical JSON serialization + SHA-256)
- **Testing:** Vitest 5

---

## Essential Commands

All commands should be executed from the repository root:

### Development & Build
- `npm run dev` — Concurrently builds and watches both `@nexus/api` and `@nexus/worker` with Turborepo.
- `npm run dev -- --filter=@nexus/api` — Run only the API service.
- `npm run dev -- --filter=@nexus/worker` — Run only the Kafka worker service.
- `npm run build` — Build all workspace packages (`turbo run build`).

### Quality & Verification
- `npm run check` — **Run on every code change**: typechecks, tests, and builds all workspace packages.
- `npm run typecheck` — Run TypeScript type checking across monorepo packages and root tools.
- `npm test` — Builds all packages and runs unit/integration tests with Vitest against embedded PGlite.
- `npm run test:integration` — Runs real PostgreSQL concurrency tests (requires `$env:INTEGRATION_DATABASE_URL`).

### Infrastructure & Operations
- `npm run infra:up` — Start local Kafka, PostgreSQL, LocalStack S3, and Kafka Connect (`docker compose up -d --wait`).
- `npm run infra:down` — Stop infrastructure containers and preserve volumes.
- `npm run topics:setup` — Initialize Kafka topics (`osint.raw.v1` and `osint.quarantine.v1`).
- `npm run db:migrate` — Apply PostgreSQL schema migrations (`packages/database/src/schema.sql`).
- `npm run archive:register` — Register the Kafka Connect S3 sink connector.
- `npm run demo:publish` — Publish a demo OSINT event to Kafka.
- `npm run replay -- <path-to-archive.avro>` — Replay raw events from an Avro archive back into Kafka.

---

## Boundaries & Golden Rules

### Always
- **Run `npm run check`** before concluding any task involving code modifications.
- **Report infrastructure limitations**: If Docker or external infrastructure checks cannot run, explicitly state this to the user.
- **Acknowledge Kafka only after durable persistence**: Commit Kafka offsets only after PostgreSQL transaction commits or after successful publication to the quarantine topic.
- **Preserve idempotency and replay invariants**: Always check `processing_receipts` and deliveries. Never bypass duplicate detection.
- **Use parameterized SQL**: Never interpolate raw strings into SQL queries. Use parameterized placeholders (`$1`, `$2`, etc.).
- **Synchronize schema changes**: Any changes to database models must update both `packages/database/src/schema.sql` and the migration script.
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
- **Never use offset-based pagination (`OFFSET ... LIMIT`)** on document listings: use cursor-based keyset pagination with deterministic tie-breakers.

### Ask First
- Adding any new npm dependency to any app or package.
- Modifying the core event schema contract (`packages/contracts/src/index.ts`).
- Altering database schema or indexes (`packages/database/src/schema.sql`).
- Changing Kafka topics, consumer groups, or partitioning logic.
- Modifying root configurations: `turbo.json`, `tsconfig.base.json`, `compose.yaml`.

---

## Monorepo Architecture & Directory Structure

```text
apps/
  api/                 # NestJS REST API (Express adapter, Auth Guard, Health probes, Document routes)
    src/
      app.ts           # App factory (NestFactory.create, Express configuration, global filters)
      auth.guard.ts    # Constant-time Bearer token authentication guard
      documents.*.ts   # Document query controller & service (cursor pagination, Zod validation)
      health.controller.ts # Liveness (/health/live) and DB Readiness (/health/ready)
      http-error.filter.ts # Global exception filter preventing credential leakage
      tokens.ts        # Dependency injection tokens
  worker/              # NestJS standalone Kafka processing worker
    src/
      index.ts         # Standalone context bootstrap and signal handling
      worker.service.ts # Kafka consumer/producer lifecycle & offset commit management
      process.ts       # Message processing, validation, transactional ingest & DLQ routing
packages/
  contracts/           # Shared event schema, types, canonical JSON & hashing
    src/index.ts       # Zod OsintEvent schema, canonicalJson(), hash(), normalize()
  database/            # PostgreSQL repository, migration and ingestion logic
    src/
      index.ts         # Pool factory, ingest() transaction, document repository
      migrate.ts       # Schema migration runner
      schema.sql       # PostgreSQL DDL (7 core tables + indexes)
infra/
  connect/             # Kafka Connect Dockerfile & S3 connector configuration
  localstack/          # LocalStack S3 emulator init scripts
scripts/               # CLI utilities (topics setup, demo publisher, archive replay)
tests/                 # Vitest test suite (API tests, Worker tests, PGlite DB tests, Integration)
```

### Package Relationships & Exports
- Apps depend on packages via workspace references (`"@nexus/contracts": "*"`).
- Packages export TypeScript types, development source (`src/index.ts`), and build output (`dist/index.js`).
- Internal changes to `@nexus/contracts` or `@nexus/database` must be built (`npm run build`) for dependent apps to reflect the changes.

---

## Ingestion Pipeline & Data Guarantees

### 1. Ingestion Guarantees & Lifecycle
1. **At-Least-Once Delivery with Idempotent Ingestion**:
   - Every Kafka message is consumed with `autoCommit: false`.
   - Message payload is validated against `eventSchema` using Zod.
   - If invalid JSON or schema violation: publish to `osint.quarantine.v1` (with base64 original bytes and error reason), then commit offset.
2. **Transactional Database Processing**:
   - `ingest()` executes within a single PostgreSQL transaction (`BEGIN ... COMMIT / ROLLBACK`).
   - Inserts into `sources` and `ingest_events`.
   - Verifies event hash: if `eventId` was already used with different payload content, throws `EventConflictError` and quarantines event.
   - Records delivery in `deliveries` (`stream_id`, `topic`, `partition`, `offset_value`). If same transport offset points to different event, quarantines for invalid stream ID.
   - Inserts into `processing_receipts` (`event_id`, `processor_version`). If receipt already exists, marks as `{ duplicate: true }` and commits without reprocessing.
   - Locks and updates `documents` (`INSERT ... ON CONFLICT (source_id, external_id) DO UPDATE`).
   - Deduplicates content versions in `document_versions` by `(document_id, content_hash)`.
   - Protects latest observation: older observation timestamps never overwrite `current_version_id` or `last_seen_at`. Equal timestamps preserve first-arriving version.
3. **Kafka Offset Commitment**:
   - Offset `(offset + 1)` is committed **only** after the database transaction commits or quarantine publication completes.
   - Heartbeats are maintained during processing to avoid consumer group rebalance.

### 2. Dual Path Ingestion
- **Operational Path (Worker → PostgreSQL)**: Real-time processing for immediate queryability via NestJS API.
- **Archival Path (Kafka Connect → S3)**: Independent consumer group (`nexus-connect`) archiving raw message bytes into Avro files on S3. Does not depend on database availability.
- **Replay**: `npm run replay` replays raw bytes into Kafka with original `eventId`. Ingestion idempotency prevents duplicate document versions or receipts.

---

## NestJS API & Worker Conventions

### NestJS API (`apps/api`)
- **Express Platform**: Always use default Express adapter (`NestFactory.create` with `disable('x-powered-by')`). Do not use Fastify.
- **Authentication**: `BearerGuard` validates tokens using constant-time comparison (`timingSafeEqual`) to mitigate timing attacks. Tokens must be at least 24 characters.
- **Health Probes**:
  - `GET /health/live`: Process liveness (returns `{ status: 'ok' }`).
  - `GET /health/ready`: Database connectivity check (returns 503 if DB is unreachable or unmigrated; never leaks DB error details).
- **Pagination**:
  - Cursor-based pagination using composite sorting `(last_seen_at DESC, id DESC)`.
  - Encode cursors as URL-safe base64 JSON.
  - Return shape: `{ "items": [...], "nextCursor": "..." | null }`.
- **Error Handling**: Use `HttpErrorFilter` to format exceptions uniformly as `{ "error": message }`.

### NestJS Worker (`apps/worker`)
- **Standalone Context**: Initialized with `NestFactory.createApplicationContext` (no HTTP listener).
- **Lifecycle Management**: Implement `OnModuleInit` and `OnApplicationShutdown`.
- **Resource Cleanup**: In `onApplicationShutdown`, disconnect Kafka consumer, producer, and close database pool using `Promise.allSettled`.
- **Consumer Crashes**: Listen for `consumer.events.CRASH` and invoke fatal handler when unrecoverable to let supervisor restart the container/process.

---

## Database & Query Guidelines

### Schema Rules
- Use PostgreSQL-native types: `uuid`, `timestamptz`, `jsonb`, `text`, `bigint`.
- Tables: `sources`, `ingest_events`, `deliveries`, `documents`, `document_versions`, `event_documents`, `processing_receipts`.
- Composite foreign keys and constraints guarantee relational consistency (e.g. `current_version_belongs_to_document`).
- Indexes must support common queries and pagination (e.g. `documents_listing` on `(last_seen_at DESC, id DESC)`).

### Repository Pattern
- Define repository methods inside `packages/database/src/index.ts`.
- Expose clear functional interfaces: `ready()`, `list(options)`, `get(id)`.
- Use parameterized query builders to dynamically construct `WHERE` conditions without SQL injection vulnerabilities.

---

## Testing Standards

### 1. Embedded Testing (Default)
- Use `@electric-sql/pglite` for database tests in `tests/database.test.ts`.
- Automatically executes `schema.sql` on an in-memory embedded PostgreSQL engine.
- Fast, self-contained, and runnable in CI or local environments without Docker.

### 2. Integration & Concurrency Testing
- `tests/database.integration.test.ts` executes concurrency stress tests against real PostgreSQL.
- Triggered when `INTEGRATION_DATABASE_URL` is defined.
- Creates an isolated disposable schema (`test_<uuid>`), executes the tests, and tears it down in `afterAll`.

### 3. API & Lifecycle Testing
- `tests/api.test.ts` tests compiled endpoints against real local HTTP sockets (`dist/app.js`).
- `tests/worker-lifecycle.test.ts` tests consumer initialization, shutdown, and error propagation.
- Always run `turbo run build` before executing Vitest to ensure compiled decorators match source code.

---

## General Coding Standards

### TypeScript & ESM
- Use strict typing throughout all packages.
- Always provide explicit return types on public service methods and repository functions.
- Avoid default exports; prefer named exports for better discoverability and refactoring support.
- File imports must include explicit `.js` extensions for ESM compatibility.

### Functions & Classes
- NestJS providers, controllers, and guards must be decorated classes (`@Injectable()`, `@Controller()`, `@UseGuards()`).
- Utility functions, hashing algorithms, and schema definitions should be pure functions or constants.
- Prefer arrow functions for callbacks, handlers, and array transformations.

### Error Handling & Logging
- Use NestJS `Logger` (`new Logger(ContextName)`).
- Distinguish between **transient infrastructure errors** (throw to trigger retry/restart) and **poison-pill domain errors** (quarantine to DLQ and commit offset).
- Never log raw authorization tokens or database credentials.

### File Organization & Sizing
- Keep individual source files focused, modular, and generally under ~150 lines.
- Extract complex query building, schema validation, and helper logic into dedicated utilities or domain modules.
