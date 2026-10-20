import { eq } from 'drizzle-orm';
import { hash, type Delivery, type OsintEvent } from '@nexus/contracts';
import { enrichmentJobs, inputSnapshots, item } from '../schema/index.js';
import type { IngestTransaction } from '../types.js';
import { rawDeliveryBytes, sha256 } from './snapshots.js';

export { recordRawDelivery } from './snapshots.js';

export interface EnrichmentJobDescriptor {
  readonly jobType: string;
  readonly processorVersion: string;
}

export const DEFAULT_ENRICHMENT_PIPELINE: readonly EnrichmentJobDescriptor[] = [
  { jobType: 'sentiment', processorVersion: 'sentiment.v1' },
  { jobType: 'test', processorVersion: 'test.v1' },
];

/**
 * Persists an input snapshot of the raw payload and schedules the configured enrichment jobs.
 * Runs atomically inside the ingestion transaction.
 */
export async function scheduleEnrichment(
  tx: IngestTransaction,
  event: OsintEvent,
  delivery: Delivery,
  itemId: string,
  current: boolean,
  pipeline: readonly EnrichmentJobDescriptor[] = DEFAULT_ENRICHMENT_PIPELINE,
): Promise<void> {
  const [stored] = await tx.select().from(item).where(eq(item.item_id, itemId));
  if (!stored) throw new Error('Item missing after ingestion');
  if (!current || stored.current_event_id !== event.eventId) return;

  const rawBytes = rawDeliveryBytes(event, delivery);
  const parsed: unknown = JSON.parse(rawBytes.toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid raw snapshot');
  }
  const rawPayload = parsed as Record<string, unknown>;

  const inputHash = hash({
    itemId,
    contentRevision: stored.content_revision.toString(),
    contentHash: stored.content_hash,
  });

  await tx
    .insert(inputSnapshots)
    .values({
      event_id: event.eventId,
      item_id: itemId,
      content_revision: stored.content_revision,
      observed_at: event.observedAt,
      stream_id: delivery.streamId,
      topic: delivery.topic,
      partition: delivery.partition,
      offset_value: BigInt(delivery.offset),
      raw_bytes: rawBytes,
      raw_sha256: sha256(rawBytes),
      raw_payload: rawPayload,
      input_hash: inputHash,
    })
    .onConflictDoNothing();

  for (const descriptor of pipeline) {
    await tx
      .insert(enrichmentJobs)
      .values({
        item_id: itemId,
        content_revision: stored.content_revision,
        event_id: event.eventId,
        job_type: descriptor.jobType,
        processor_version: descriptor.processorVersion,
        input_hash: inputHash,
      })
      .onConflictDoNothing();
  }
}
