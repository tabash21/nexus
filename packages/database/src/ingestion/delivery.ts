import { sql } from 'drizzle-orm';
import type { Delivery } from '@nexus/contracts';
import { EventConflictError } from '../errors.js';
import { deliveries } from '../schema/index.js';
import type { IngestTransaction } from './types.js';

/**
 * Records the Kafka transport coordinates (stream, topic, partition, offset) that delivered the event.
 * Redelivery of the same offset is a no-op; the conflict update keeps the existing event_id so that
 * RETURNING always yields the stored row. If that offset already maps to a different event, the
 * stream identity is misconfigured (e.g. two clusters sharing KAFKA_STREAM_ID) and we refuse it.
 */
export async function recordDelivery(tx: IngestTransaction, delivery: Delivery, eventId: string, rawUri?: string): Promise<void> {
  const [transport] = await tx.insert(deliveries).values({
    stream_id: delivery.streamId,
    topic: delivery.topic,
    partition: delivery.partition,
    offset_value: BigInt(delivery.offset),
    event_id: eventId,
    raw_uri: rawUri,
  }).onConflictDoUpdate({
    target: [deliveries.stream_id, deliveries.topic, deliveries.partition, deliveries.offset_value],
    set: { event_id: sql`deliveries.event_id` },
  }).returning();

  if (transport?.event_id !== eventId || (rawUri && transport.raw_uri !== rawUri)) {
    throw new EventConflictError('Transport identity reused; check KAFKA_STREAM_ID');
  }
}
