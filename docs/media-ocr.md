# Attachment retrieval and local OCR

The silver writer saves each current attachment and its `ingest.media_jobs` record
in the same PostgreSQL transaction. Kafka acknowledgment follows this durable
transaction, independently of background download/OCR. `MediaProcessingService`
claims one attachment at a time and runs local Tesseract and Poppler executables.
There are no hosted OCR/LLM or other paid inference calls.

## Supported inputs and bounds

`media-ocr.v1` supports single-image JPEG/PNG and unencrypted PDFs. Animated PNG,
other image/document formats, video, audio, and link cards are unsupported.
English, Hebrew, and Arabic packs (`eng+heb+ara`) are checked at startup. Recognition
of handwriting, poor scans, or every font/layout is not guaranteed. An empty
result means no text was recognized, not proof that the image contains no text.

| Resource | Limit |
| --- | --- |
| Download | 20 MiB; 30 seconds including DNS/redirects |
| Connection / inactivity | 5 seconds / 10 seconds |
| Redirects | 3; every destination revalidated |
| Image | 20 million pixels |
| PDF | 10 pages; sequential rendering, longest side at most 4096 pixels |
| Native subprocess | 30 seconds wall/CPU time; 1 GiB address space |
| Native output file / temporary directory | 256 MiB file limit / directory size checked after rendering |
| OCR output | 1 MiB per attachment; exceeding it fails explicitly |
| Attempt / lease | 180 seconds / 90 seconds, renewed every 30 seconds |
| Concurrency / attempts | 1 per process / 3 attempts |

Linux `prlimit` bounds native resources. Cancellation kills the native process.
The Docker runtime includes native tools, language packs, and util-linux. Temporary
directories are private and removed after each attempt. Job/claim-specific directories
are isolated by a database-identity scope. Startup and minute-interval cleanup inspect
up to 256 entries and reclaim up to 100 inactive attempts per sweep after checking
their database claim; active claims, other scopes, unrelated files, and symlinks are
preserved. This also recovers files left by SIGKILL/OOM/crashes. Downloads are streamed
with a byte counter regardless of Content-Length. Compressed HTTP responses are
rejected. Signatures/headers are checked independently of filenames and HTTP MIME;
native decoders validate the content. PDF pages are rendered before OCR so results
describe visible pixels rather than potentially hidden/stale PDF text layers.

## URL and archive boundaries

Source retrieval accepts HTTPS on port 443 without URL credentials. It rejects
nonpublic IPv4/IPv6 addresses, DNS answers containing them, and unsafe redirects.
Connections pin the validated address while retaining TLS certificate/hostname
verification. `MEDIA_ALLOWED_HOSTS` optionally restricts exact hostnames (comma
separated); an empty list allows public destinations subject to address policy.
There is no automatic URL refresh or authenticated platform retrieval. Telegram's
native photo/document references currently lack download URLs and receive
`missing_url`; collectors must supply usable URLs.

S3 uses trusted server configuration: `S3_BUCKET`, `S3_REGION`, optional
`S3_ENDPOINT`, and standard AWS credentials. Its private local endpoint is separate
from public-source URL policy. Complete supported downloads are archived before
OCR, preserving exact bytes under:

```text
media/<reality>/<SHA-256 item ID>/<attachment generation>/<SHA-256 bytes>.<format>
```

`core.item.raw_uri` remains the bronze delivery reference. `item_media.s3_uri`
identifies attachment bytes. Archive checkpoints are fenced. Retry reads accept
only the configured bucket and the job's exact generation prefix and verify the
byte hash. Corrupt/text-free attachments can retain archives. Replacement can
leave unreferenced archive objects; no automatic object deletion is performed.

## Identity, outcomes, and recovery

`core.item_media` retains its `(item_id, position)` key. New/changed attachments get
fresh `attachment_generation` UUIDs; identical observations retain generation and
OCR/archive outputs. Complete lists remove absent positions; partial lists preserve
omissions. Delete/re-add creates a new generation even for an identical URL.
Changes behind identical URLs and source metadata require source versions/checksums
to detect. Event identities, delivery records, and receipts are unchanged.

Jobs are unique by item, position, generation, and processor version. Every
checkpoint, failure, and completion takes the same item advisory lock as ingestion,
checks the active unexpired claim, and compares the current generation in the write
transaction. Replaced/removed attachment jobs become stale; lost claims cannot
write. Text/title content revisions remain independent.

Recognized text is stored only in `core.item_media.ocr_text`. A successful empty
result is `''` with outcome `no_text`; a new attachment with failed OCR retains NULL.
Missing URL/file, forbidden or possibly expired URL, unsupported format, unreadable
content, and policy limits have distinct outcomes. Transient network/server errors,
rate limits, timeouts, and infrastructure failures retry up to three attempts with
backoff (5 then 10 seconds). Exhausted crash leases become failed. Persistence
failures never become successful work. Logs/errors use stable codes, excluding
signed URLs and native-tool output.

## Operation

OCR is enabled by default and requires the S3 bucket and native tools. Set
`MEDIA_OCR_ENABLED=false` for a host writer without those tools; ingestion still
schedules durable jobs for later processing. Supply optional settings through the
deployment environment or a Compose override. Protected environment/Compose files
are unchanged by this feature. Apply migrations before starting the new writer.

```sh
node --env-file-if-exists=.env apps/enrichment-worker/dist/index.js media-backfill
node --env-file-if-exists=.env apps/enrichment-worker/dist/index.js media-stats
node --env-file-if-exists=.env apps/enrichment-worker/dist/index.js media-retry <JOB_UUID>
```

Backfill reads current media directly in bounded keyset batches, is idempotent, and
does not depend on legacy input snapshots. Manual retry accepts failed jobs only
while their attachment generation remains current. Shutdown cancels/drains media
work before closing the shared database pool.

`buildMediaEnrichmentInput` is an opt-in helper for follow-up consumers. It retains
original text separately, labels OCR text, and hashes attachment generations/text
alongside the original content revision. It does not run summaries/topics/entities/
embeddings. Those consumers must validate the combined hash when scheduling,
saving, and reading OCR-dependent results; text-revision checks alone are insufficient.

## Verification

`npm run check` builds packages, checks types/format/migrations, and runs embedded
database, downloader, worker, and API tests. Native tests are opt-in:

```sh
docker build --target media-test -f infra/node/Dockerfile -t nexus-media-test .
docker run --rm -e RUN_MEDIA_NATIVE=true nexus-media-test npm run check
```

The test image includes Pango/font tooling for Hebrew/Arabic fixtures.
`tests/fixtures/media/key.pem` is a public test-only TLS fixture key.
Real PostgreSQL concurrency tests require `INTEGRATION_DATABASE_URL`.
The media end-to-end suite additionally requires native tools, Kafka/S3, and
`RUN_MEDIA_E2E=true`. Optional settings: `PIPELINE_KAFKA_BROKERS`,
`PIPELINE_S3_ENDPOINT`, and `PIPELINE_S3_BUCKET`.

```sh
RUN_MEDIA_E2E=true npm run test:integration
```

The suite creates isolated databases/topics/groups and uses real Kafka, PostgreSQL,
S3, Tesseract, Poppler, NestJS lifecycle, an authenticated HTTP API, and a real local
HTTPS fixture server. Only fixture DNS/connection routing is injected to reach
localhost; production policy rejects localhost. Unit tests separately exercise
production destination validation. Tests never call an external OCR API.
