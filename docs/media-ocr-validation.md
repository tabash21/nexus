# Media OCR implementation validation

Validated on 2026-10-20. Existing application databases were not migrated or altered.
No npm dependencies, production Kafka topics/groups, or protected environment/Compose
configuration files were changed. Migration `0007_media_ocr` is prepared for deployment.

## Completed checks

- `RUN_MEDIA_NATIVE=true npm run check`: **190 tests passed across 22 files**.
- Full monorepo production builds, application/root-tools TypeScript checks, and
  Prettier checks passed.
- Drizzle model/migration parity and embedded migration-chain/schema snapshot
  catalog equivalence passed.
- Native Tesseract/Poppler tests passed for PNG, JPEG, ordered PDF pages, Hebrew,
  Arabic, text-free images, unreadable documents, page limits, and cancellation.
- Real certificate-verified local HTTPS retrieval passed, including missing and
  expired responses and redirect rejection.
- Embedded persistence tests passed for replay, replacement/delete-re-add fencing,
  expired claims, checkpoints/retries, backfill, transaction rollback, and unchanged
  source text. Processing/shutdown and actual subprocess-kill recovery tests passed.

The environment initially lacked Linux Node and native OCR tools. A verified
Node 24 runtime and signed Debian Bookworm OCR/PDF/font packages were downloaded
and extracted under `/tmp`; system packages were not installed or replaced.
The final full check ran with these tools available on PATH.

## Independent reviewer: two passes

1. The reviewer found abandoned temporary files after SIGKILL/OOM/crashes.
   Fixed with private database-scoped, job/claim-specific directories and bounded
   cleanup that verifies claim inactivity and preserves live claims, other scopes,
   unrelated files, and symlinks. Added an actual killed-process regression test.
   Also added the requested PostgreSQL ingestion/replacement versus checkpoint/
   completion concurrency scenario.
2. Final review reported **no remaining confirmed actionable findings**. The reviewer
   independently reran three regression suites: **16 tests passed**. No third pass
   was performed.

## Remaining production validation gates

The two real-infrastructure suites were attempted with disposable-database helpers,
unique Kafka topics/groups, and isolated local test-stack endpoints. Setup failed:

- PostgreSQL: connection refused at `127.0.0.1:55432`.
- Kafka: connection refused at `127.0.0.1:19092`.
- Five test cases did not execute: two PostgreSQL concurrency tests and three full
  Kafka/bronze/silver/HTTPS/S3/native-OCR/PostgreSQL/API scenarios.

Docker's test-image build also failed while its engine became unavailable. Windows
reported a full C: drive; subsequent Docker engine checks and restart timed out.
The final Docker image build, real PostgreSQL concurrency tests, and complete media
end-to-end suite must pass after infrastructure recovery. They are **not counted
as passed**, and production readiness is not yet established.

See [media OCR operation and test commands](media-ocr.md). Native Telegram references
without download URLs remain an explicitly handled `missing_url` outcome; no
authenticated Telegram media downloader was introduced.
