# Nexus Code Quality & Engineering Standards

This document specifies the engineering conventions, architectural guidelines, and refactoring standards enforced across the Nexus monorepo, particularly within `packages/*` and standalone workers (`apps/worker`, `apps/enrichment-worker`).

---

## 1. Code Style & Automated Formatting

- **Prettier Configuration**: Monorepo code adheres to `.prettierrc.json`:
  - `singleQuote: true`
  - `trailingComma: "all"`
  - `printWidth: 100`
  - `tabWidth: 2`
  - `semi: true`
- **Commands**:
  - `npm run format`: Automatically formats all TypeScript/JavaScript files in `apps/worker`, `apps/enrichment-worker`, and `packages/`.
  - `npm run format:check`: Verifies that code adheres to formatting rules (included in `npm run check`).

---

## 2. File Organization & Decomposition

To maintain long-term maintainability and readability, Nexus follows the Single Responsibility Principle (SRP):

- **Target File Size**: Files should remain focused and typically under 200–300 lines of code.
- **Sub-Directory Grouping**: When a module or domain feature grows in complexity, decompose it into a dedicated folder:
  - **Data Contracts & Types**: Dedicated `<domain>.types.ts` or `types.ts` (e.g., `packages/database/src/jobs/job.types.ts`, `apps/worker/src/types.ts`).
  - **Pure Extraction & Transformation**: Independent extractors and normalizers without I/O (e.g., `apps/worker/src/adapters/telegram/extractors.ts`).
  - **Operational Lifecycle**: Distinct lifecycle transitions into dedicated files (e.g., `packages/database/src/jobs/leasing.ts`, `completion.ts`, `maintenance.ts`).
  - **Domain Builders**: Separate observation pipelines and normalization helpers into dedicated modules (e.g., `apps/worker/src/observation/`).

---

## 3. Backward Compatibility & Deep-Import Shims

When decomposing monolithic files into sub-modules:
- External scripts (`scripts/`), test suites (`tests/`), or cross-package imports may rely on legacy file paths.
- **Always provide a lightweight re-export shim** at the legacy path:
  - Example: `packages/database/src/jobs.ts` forwards to `./jobs/index.js`.
  - Example: `apps/worker/src/adapters/types.ts` forwards to `./source-adapter.js`.
  - Example: `apps/enrichment-worker/src/resources.ts` forwards to `./enrichment.resources.js`.
- Mark forwarding shims with `@deprecated` or descriptive comments to guide future developers.

---

## 4. NestJS Application Contexts & Dependency Injection

For standalone worker contexts:
- **Typed Injection Tokens**: Define dependency injection tokens explicitly in `<service>.tokens.ts` (e.g., `WORKER_DEPENDENCIES`, `ENRICHMENT_RESOURCES`). Avoid magic strings.
- **Resource Module Isolation**: External infrastructure client lifecycle (PostgreSQL pool, Kafka consumers/producers, S3 clients) must reside in `<service>.resources.ts` behind typed interfaces, separate from business logic.
- **Validation Separation**: Kafka message validation and quarantine logic must reside in dedicated validator units (e.g., `silver.validator.ts`) to keep ingestion handlers clear and readable.

---

## 5. Strict TypeScript & Type Safety

- **Prohibition of `any`**: `any` and `as any` are strictly prohibited across the codebase.
- **Discriminated Unions & Exhaustiveness**: Always handle all members of a union explicitly. Implement compile-time exhaustiveness guards (`const _exhaustive: never = ...`) in default cases.
- **Centralized Safe Conversion**: Do not duplicate type-casting logic (such as string-to-BigInt conversions); use centralized helpers like `toBigInt` in `@nexus/database/src/ingestion/bigint.js`.

---

## 6. Monorepo Package Boundaries & Ownership

- **`@nexus/kafka`**: Central home for all broker interactions, connection factories, heartbeat management (`withHeartbeat`), offset arithmetic (`nextOffset`), and default topic constants.
- **`@nexus/contracts`**: Central home for schemas, canonical hashing (`hashCanonicalJson`), topic/platform regular expressions (`PLATFORM_PATTERN`, `TOPIC_PATTERN`), and domain normalizers.
- **`@nexus/database`**: Central home for Drizzle models, migrations, transactional ingest pipelines, delivery snapshots, reality integrity checks (`assertRealityRegistered`), and job leasing/completion.
- **`apps/worker`**: Focuses strictly on raw ingestion, S3 bronze archival, payload adaptation, and silver/quarantine publication.
- **`apps/enrichment-worker`**: Focuses strictly on silver consumption, transactional PostgreSQL writes, and future model processing.
- **`apps/api`**: Focuses strictly on serving read-only queries, keyset pagination, and health endpoints over HTTP (Express).
