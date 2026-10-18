import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Delivery, OsintEvent } from '@nexus/contracts';
import { deliverySnapshots } from '../schema/index.js';
import { EventConflictError } from '../errors.js';
import type { IngestTransaction } from '../types.js';

export const sha256 = (value: Buffer): string => createHash('sha256').update(value).digest('hex');

/**
 * Extracts raw payload bytes from an incoming delivery, falling back to canonical event JSON.
 */
export function rawDeliveryBytes(event: OsintEvent, delivery: Delivery): Buffer {
  const incoming = delivery as Delivery & { value?: Buffer | null };
  return incoming.value ?? Buffer.from(JSON.stringify(event));
}

/**
 * Records the raw delivery payload bytes and verifies byte parity at fixed transport coordinates.
 */
export async function recordRawDelivery(tx: IngestTransaction, event: OsintEvent, delivery: Delivery): Promise<void> {
  const rawBytes = rawDeliveryBytes(event, delivery);
  const digest = sha256(rawBytes);

  await tx
    .insert(deliverySnapshots)
    .values({
      stream_id: delivery.streamId,
      topic: delivery.topic,
      partition: delivery.partition,
      offset_value: BigInt(delivery.offset),
      event_id: event.eventId,
      raw_bytes: rawBytes,
      raw_sha256: digest,
    })
    .onConflictDoNothing();

  const [stored] = await tx
    .select({ raw_sha256: deliverySnapshots.raw_sha256 })
    .from(deliverySnapshots)
    .where(
      and(
        eq(deliverySnapshots.stream_id, delivery.streamId),
        eq(deliverySnapshots.topic, delivery.topic),
        eq(deliverySnapshots.partition, delivery.partition),
        eq(deliverySnapshots.offset_value, BigInt(delivery.offset)),
      ),
    );

  if (stored?.raw_sha256 !== digest) {
    throw new EventConflictError('Delivery bytes changed at fixed transport coordinates');
  }
}
