import { eventSchema, type Delivery, type OsintEvent } from '@nexus/contracts';
import { EventConflictError } from '@nexus/database';
export type Message = Delivery & { value: Buffer | null; key: Buffer | null; timestamp: string; headers?: unknown };
export type Dependencies = {
  ingest: (event: OsintEvent, delivery: Delivery) => Promise<unknown>;
  quarantine: (record: Record<string, unknown>) => Promise<void>;
  commit: (message: Delivery) => Promise<void>;
};
export async function processMessage(message: Message, dependencies: Dependencies) {
  let event: OsintEvent;
  try {
    if (message.value === null) throw new Error('Tombstones are not supported by this event contract');
    event = eventSchema.parse(JSON.parse(message.value.toString('utf8')));
  } catch {
    await quarantine('invalid-event');
    await dependencies.commit(message);
    return;
  }
  try { await dependencies.ingest(event, message); }
  catch (error) {
    if (!(error instanceof EventConflictError)) throw error; // Infrastructure failure: do not discard or acknowledge.
    await quarantine(error.message);
  }
  await dependencies.commit(message);

  async function quarantine(reason: string) {
    await dependencies.quarantine({
      reason, streamId: message.streamId, topic: message.topic, partition: message.partition,
      offset: message.offset, timestamp: message.timestamp, processorVersion: '1',
      valueBase64: message.value?.toString('base64') ?? null,
      keyBase64: message.key?.toString('base64') ?? null, headers: message.headers ?? {},
    });
  }
}
