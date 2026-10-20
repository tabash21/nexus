# Nexus — Agent Coding Standards & Architecture Guide

Nexus is an OSINT data platform monorepo. The worker archives raw Kafka deliveries to S3 and publishes normalized `items.silver` observations. The enrichment worker currently consumes silver and writes PostgreSQL transactionally, running the inline `lang.v1` language detector; model processing is not active. Kafka Connect is retired; legacy job and archive code remains for compatibility. The NestJS query API and Next.js dashboard serve the stored data.

---

## Tech Stack

- **Monorepo & Build Tooling:** Turborepo 2, npm workspaces (Node.js >= 22 / 24, npm 11)
- **Backend Framework:** NestJS 12 (Express adapter for API, standalone application contexts for Worker and Enrichment Worker)
- **Frontend / Telemetry:** Next.js 15, React 19, TailwindCSS, Lucide icons (`apps/dashboard`)
- **Language & Runtime:** TypeScript 5.9 (Strict mode, ESM `NodeNext`, Decorator Metadata enabled)
- **Message Broker & Ingestion:** Apache Kafka 4 (KRaft mode), KafkaJS 2
- **Raw Archive:** Worker-owned gzip NDJSON objects in LocalStack or AWS S3 (AWS SDK); existing legacy Avro archives remain replayable
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
- `npm run check` — **Run on every code change**: verifies formatting, typechecks, tests, runs model checks, and builds all workspace packages.
- `npm run format` — Format code across packages and workers with Prettier.
- `npm run format:check` — Check code formatting across packages and workers.
- `npm run typecheck` — Run TypeScript type checking across monorepo packages and root tools.
- `npm test` — Builds all packages and runs unit/integration tests with Vitest against embedded PGlite.
- `npm run test:integration` — Runs real PostgreSQL concurrency tests (requires `$env:INTEGRATION_DATABASE_URL`).

### Infrastructure & Operations
- `npm run infra:up` — Start local Kafka, PostgreSQL, and LocalStack S3 (`docker compose up -d --wait`).
- `npm run infra:down` — Stop infrastructure containers and preserve volumes.
- `npm run local:dev` — Starts infrastructure, checks/prepares database, registers connectors/topics, and launches services.
- `npm run topics:setup` — Initialize Kafka topics (`raw.<platform>.v1`, `sim.<platform>.v1` for 10 platforms, and `osint.quarantine.v1`).
- `npm run db:prepare` — Check models, apply migrations, and verify schema against reference DB.
- `npm run db:migrate` — Apply pending PostgreSQL schema migrations.
- `npm run demo:publish` — Publish a demo OSINT event to Kafka.
- `npm run replay -- <archive.jsonl.gz|archive.avro> <topic>` — Replay exact raw bytes from current or legacy archives.

---

## Boundaries & Golden Rules

### Always
- **Run `npm run check`** before concluding any task involving code modifications.
- **Report infrastructure limitations**: If Docker or external infrastructure checks cannot run, explicitly state this to the user.
- **Acknowledge Kafka only after durable handoff**: The mapper commits a raw offset after S3 archival and acknowledged silver or quarantine publication. The silver writer commits only after its PostgreSQL transaction or successful quarantine publication.
- **Preserve idempotency and replay invariants**: Always check `ingest.processing_receipts` and deliveries. Never bypass duplicate detection.
- **Enforce reality separation**: Reality 0 = real-world operational sources; Reality 1 = simulation sources. Reality is worker-assigned based on topic, NEVER supplied in Kafka payloads.
- **Use parameterized SQL**: Never interpolate raw strings into SQL queries. Use parameterized placeholders (`$1`, `$2`, etc.).
- **Synchronize schema changes**: Any changes to database models must update typed Drizzle schemas in `packages/database/src/schema/`, generate migrations, and update `packages/database/src/schema.sql`.
- **Maintain NodeNext ESM imports**: All relative imports in TypeScript source files must use the `.js` extension (e.g. `import { foo } from './foo.js'`).
- **Build before running tests**: The API and worker tests rely on compiled TypeScript artifacts (`dist/`) for decorator metadata and reflection.
- **Format code with Prettier**: Adhere to the monorepo Prettier standards (`.prettierrc.json`) checked by `npm run format:check`.
- **Preserve deep-import compatibility**: When refactoring or modularizing internal packages and workers, maintain backward-compatible re-export shims at legacy paths if scripts or tests rely on them.

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

## Code Quality, Modularization & Refactoring Standards

All monorepo packages (`packages/*`) and backend workers (`apps/worker`, `apps/enrichment-worker`) adhere to the following architectural and quality standards:

### 1. File Size, Scope & Decomposition
- **Single Responsibility Principle (SRP):** Files should remain focused and typically under 200–300 lines of code.
- **Dedicated Sub-Directories for Domains:** When a module grows or handles multiple lifecycle stages, break it down:
  - Separate pure data types into `<name>.types.ts` or `types.ts` (e.g., `packages/database/src/jobs/job.types.ts`, `apps/worker/src/types.ts`).
  - Extract pure parsing, sanitization, and transformation into `extractors.ts` or `normalize.ts` (e.g., `apps/worker/src/adapters/telegram/extractors.ts`).
  - Isolate distinct lifecycle transitions into dedicated files (e.g., `packages/database/src/jobs/leasing.ts`, `completion.ts`, `maintenance.ts`).
  - Extract observation and silver normalization pipelines into domain builders (e.g., `apps/worker/src/observation/`).

### 2. Backward Compatibility & Deep-Import Shims
- When refactoring, decomposing, or moving files, internal CLI tools (`scripts/`), cross-package imports, and test suites may depend on existing paths.
- **Always provide a lightweight re-export shim** at the legacy path (e.g., `packages/database/src/jobs.ts` re-exporting `src/jobs/index.js`, `apps/enrichment-worker/src/resources.ts` re-exporting `enrichment.resources.js`, `apps/worker/src/adapters/types.ts` re-exporting `source-adapter.js`).
- Mark shims with `@deprecated` or forwarding comments to guide future authors.

### 3. NestJS Architecture & Dependency Injection
- **Explicit DI Tokens:** Never rely on magic strings or untyped symbols for external dependencies. Define typed injection tokens in `<service>.tokens.ts` (e.g. `WORKER_DEPENDENCIES`, `ENRICHMENT_RESOURCES`).
- **Resource Module Isolation:** External infrastructure client creation (PostgreSQL pools, Kafka consumers/producers, S3 clients) must be encapsulated in `<service>.resources.ts` with explicit TypeScript interface definitions, completely decoupled from business orchestration.
- **Validation Extraction:** Keep message parsing, structural validation, and quarantine routing in dedicated validators (e.g., `silver.validator.ts`) rather than inlining validation pipelines inside service consumers.

### 4. Strict Type Safety & Clean Typing
- **Prohibit `any` and `as any`:** Always type database query options, parameters, and entities using schema-inferred types (e.g., `ItemRow['item_type']`), explicit interfaces, or Zod schemas.
- **Exhaustive Narrowing:** When branching over string unions or enums (e.g., SASL mechanisms, platform names), always implement exhaustive compile-time checks (`const _exhaustive: never = ...`).
- **Safe Type Conversion:** Use centralized, checked conversion utilities (e.g., `toBigInt` in `@nexus/database/src/ingestion/bigint.js`) rather than ad-hoc or duplicated `BigInt()` parsers.

### 5. Deduplication & Cross-Package Ownership
- **Kafka Operations:** Shared Kafka utilities like in-flight heartbeat coordinators (`withHeartbeat`), offset arithmetic (`nextOffset`), and default topics belong in `@nexus/kafka`.
- **Database & Persistence:** Common ingestion schemas, reality assertions (`assertRealityRegistered`), delivery snapshots, and queries belong in `@nexus/database`.
- **Contracts & Schemas:** Shared regex patterns (`PLATFORM_PATTERN`, `TOPIC_PATTERN`), canonical JSON serialization, and Zod models belong in `@nexus/contracts`.

### 6. Formatting & Linting
- **Prettier:** Code in `apps/worker`, `apps/enrichment-worker`, and all `packages/*` must strictly adhere to `.prettierrc.json`.
- Run `npm run format` to automatically format changes.
- `npm run check` automatically verifies formatting with `npm run format:check` before executing builds and tests.

---

## Monorepo Architecture & Folder Structure Guidelines

Nexus follows a modular monorepo layout using Turborepo and npm workspaces.

### Workspace Top-Level Organization

```text
nexus/
├── apps/
│   ├── api/                  # NestJS REST API (items, sources, authors, queries, stats, health)
│   ├── worker/               # NestJS Kafka ingestion worker (raw/sim topic consumers, adapters)
│   ├── enrichment-worker/    # NestJS silver consumer and transactional PostgreSQL writer
│   └── dashboard/            # Next.js 15 operational dashboard & telemetry UI
├── packages/
│   ├── contracts/            # Schemas, canonical hashing, normalization, topic/platform registries
│   ├── database/             # Drizzle models, migrations, transactional ingest, legacy job code
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

#### 2. Kafka Mapper Worker (`apps/worker/`)
The worker runs as a standalone NestJS application context (without HTTP):
```text
apps/worker/src/
├── index.ts                  # Standalone Nest context bootstrap & signal handling
├── worker.module.ts          # Root worker module: dynamic provider configuration
├── worker.service.ts         # Multi-platform consumer coordinator, heartbeat & offset management
├── worker.tokens.ts          # Dependency injection tokens
├── worker.resources.ts       # External resources factory (S3, Kafka, consumers, producer)
├── types.ts                  # Message delivery & worker dependencies contracts
├── process.ts                # Ingestion message orchestrator
├── observation/              # Payload adaptation, silver builder, and legacy Telegram defaults
├── adapters/                 # Ingestion adapters (telegram.v1, provisional.v1, registry, event-id)
├── heartbeat.ts              # Compatibility shim to @nexus/kafka
└── archive.ts                # Exact raw bytes and transport metadata to S3
```
- **Guidelines:** Archive before parsing. Commit only after archive plus silver or quarantine publication; keep heartbeats during S3 and Kafka calls.

#### 3. Silver Writer (`apps/enrichment-worker/`)
The enrichment worker runs as a standalone NestJS application context; inline processors run inside the ingest transaction; async model processing is future work:
```text
apps/enrichment-worker/src/
├── index.ts                  # Standalone Nest context bootstrapper & CLI dispatcher
├── cli.ts                    # Administrative CLI commands (stats, retry, backfill)
├── enrichment.module.ts      # NestJS root module
├── enrichment.service.ts     # Silver consumer, transaction boundary, and manual offsets
├── enrichment.tokens.ts      # Dependency injection tokens
├── enrichment.resources.ts   # Database pool, Kafka client, and readiness assertions
├── silver.validator.ts       # Kafka message validation & quarantine classification
├── resources.ts              # Compatibility re-export shim
├── heartbeat.ts              # Compatibility shim to @nexus/kafka
├── archive/                  # Legacy Connect reconciliation code, not active
└── processors/               # Processor interfaces; lang.v1 runs inline, async job runner not active
```
- **Guidelines:** Preserve event and delivery receipts. Commit silver offsets after PostgreSQL commits; quarantine only invalid or conflicting source events.

#### 4. Storage & Repository Package (`packages/database/`)
Shared database, migration, and persistence logic package:
```text
packages/database/src/
├── index.ts                  # Clean barrel exports of public types, errors, and repositories
├── types.ts                  # Core IngestDatabase and IngestTransaction types
├── schema/                   # Drizzle ORM models (base, registry, identity, items, enrichment, ingest)
├── schema.sql                # Declarative PostgreSQL DDL snapshot
├── migrate.ts                # Advisory-locked schema migration runner
├── migrations.ts             # Migration file verification and execution
├── ingest.ts                 # Transactional multi-table write pipeline
├── ingestion/                # Modular domain table mappers (dimensions, item, media, reality, snapshots)
├── jobs/                     # Modular job leasing, completion, and maintenance
├── jobs.ts                   # Compatibility re-export shim
└── archive.ts                # Legacy Connect link helper retained during migration
```

#### 5. Contracts & Shared Utility Package (`packages/contracts/`)
Pure contracts, validation schemas, and deterministic domain helpers:
```text
packages/contracts/src/
├── index.ts                  # Clean barrel exports of schemas, types, and pure helpers
├── schema.ts                 # Zod schema definitions and inferred domain types
├── patterns.ts               # Shared platform and topic regex patterns
├── hash.ts                   # Canonical JSON serialization and SHA-256 hashing
├── sources.ts                # Platform registry, topic mappings, and reality validation
├── silver.ts                 # Versioned mapper-to-writer envelope
└── normalize.ts              # Domain data normalization and sanitization helpers
```

#### 6. Shared Kafka Client Package (`packages/kafka/`)
Shared Kafka client factory, offset mathematics, and heartbeat coordinator:
```text
packages/kafka/src/
├── index.ts                  # Clean barrel exports
├── client.ts                 # Kafka client and SASL authentication options factory
├── heartbeat.ts              # In-flight heartbeat coordinator
├── offsets.ts                # Kafka commit offset arithmetic
└── topics.ts                 # Default topic constants
```

---

## Ingestion Pipeline & Data Guarantees

### 1. Ingestion Guarantees & Lifecycle
1. **At-Least-Once Delivery with Idempotent Ingestion**:
   - Both workers consume with `autoCommit: false`.
   - The ingestion worker archives the exact source record bytes and Kafka metadata to S3 before parsing.
   - Valid source records are mapped through platform adapters and published as `silver.v1` observations to `items.silver`; invalid records are published to `osint.quarantine.v1` with their archive URI.
   - The source offset advances only after S3 and the silver or quarantine publication are durable.
2. **Transactional Silver Processing**:
   - The enrichment worker validates silver identity, source topic, and worker-assigned reality before writing.
   - `ingest()` executes within a single PostgreSQL transaction (`BEGIN ... COMMIT / ROLLBACK`).
   - Inserts into `ingest.ingest_events` and records the silver delivery and bronze URI.
   - Verifies event hash: if `eventId` was already used with different payload content, throws `EventConflictError` and quarantines event.
   - Records delivery in `ingest.deliveries` (`stream_id`, `topic`, `partition`, `offset_value`).
   - Checks `ingest.processing_receipts` (`event_id`, `processor_version`). If receipt already exists, marks as `{ duplicate: true }` and commits without reprocessing.
   - Upserts `core.source` and `core.author`.
   - Locks and updates `core.item` while preserving the database-owned `content_revision`, and sets `lang`/`lang_confidence` from the injected language detector.
   - Saves media, immutable engagement observations, and query matches. One item can have many engagement rows, including rows captured at the same time.
   - Inserts processing receipt and commits transaction.
3. **Kafka Offset Commitment**:
   - The silver offset `(offset + 1)` is committed **only** after the database transaction commits or quarantine publication completes.
   - Heartbeats are maintained during processing to prevent consumer group rebalance.

### 2. Bronze, Silver, and Gold
- **Bronze**: Worker-owned S3 gzip NDJSON objects hold the original bytes and transport metadata.
- **Silver**: `items.silver` holds normalized observations, engagement, archive URI, and checksums.
- **Gold**: The enrichment worker consumes silver and writes PostgreSQL. `lang.v1` detects `core.item.lang`/`lang_confidence` inline from title and text; `lang_platform` keeps the platform value. Model enrichment is not active in this release.
- **Replay**: `npm run replay` replays bronze records to their original source topic. Event identity is preserved so repeated observations do not duplicate engagement or receipts.
- **Compatibility**: Kafka Connect is retired from runtime and setup. Existing Avro archives remain replayable; legacy job and archive tables are preserved.

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
- **Resource Cleanup**: The ingestion worker disconnects Kafka clients and closes its S3 client; the enrichment worker disconnects Kafka clients and closes its database pool.

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

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
