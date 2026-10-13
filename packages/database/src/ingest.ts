import { and, eq, sql } from 'drizzle-orm';
import { normalize, itemIdentity, PROCESSOR_VERSION, type OsintEvent, type Delivery } from '@nexus/contracts';
import { EventConflictError } from './errors.js';
import { deliveries, ingestEvents, processingReceipts, reality } from './schema/index.js';
import { saveDimensions } from './ingestion/dimensions.js';
import { saveItem } from './ingestion/item.js';
import { saveChildren } from './ingestion/children.js';
import type { IngestDatabase } from './ingestion/types.js';
export async function ingest(db: IngestDatabase, input: OsintEvent, delivery: Delivery, eventHash: string): Promise<{ duplicate: boolean }> {
  const event = normalize(input);
  return db.transaction(async tx => {
    const [realm] = await tx.select().from(reality).where(eq(reality.reality_id, event.realityId));
    if (!realm) throw new EventConflictError('Reality must be registered before ingestion');
    await tx.insert(ingestEvents).values({ event_id: event.eventId, event_hash: eventHash, schema_version: event.schemaVersion,
      reality_id: event.realityId, observed_at: event.observedAt }).onConflictDoNothing();
    const [stored] = await tx.select().from(ingestEvents).where(eq(ingestEvents.event_id, event.eventId)).for('update');
    if (stored?.event_hash !== eventHash || stored.reality_id !== event.realityId) throw new EventConflictError('Event ID reused with different content');
    const [transport] = await tx.insert(deliveries).values({ stream_id: delivery.streamId, topic: delivery.topic,
      partition: delivery.partition, offset_value: BigInt(delivery.offset), event_id: event.eventId })
      .onConflictDoUpdate({ target: [deliveries.stream_id, deliveries.topic, deliveries.partition, deliveries.offset_value],
        set: { event_id: sql`deliveries.event_id` } }).returning();
    if (transport?.event_id !== event.eventId) throw new EventConflictError('Transport identity reused; check KAFKA_STREAM_ID');
    const [receipt] = await tx.select().from(processingReceipts).where(and(eq(processingReceipts.event_id, event.eventId), eq(processingReceipts.processor_version, PROCESSOR_VERSION)));
    if (receipt) return { duplicate: true };
    const identity = itemIdentity(event);
    await saveDimensions(tx, event, identity.sourceId, identity.authorId);
    const { itemId, current } = await saveItem(tx, event);
    await saveChildren(tx, event, itemId, current);
    await tx.insert(processingReceipts).values({ event_id: event.eventId, processor_version: PROCESSOR_VERSION, reality_id: event.realityId, item_id: itemId });
    return { duplicate: false };
  });
}
