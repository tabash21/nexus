import { hash, PROCESSOR_VERSION, type Delivery, type OsintEvent, type SourceSubscription } from '@nexus/contracts';
import { EventConflictError } from '@nexus/database';
import { adapt } from './adapters/index.js';
import { runQuickProcessors, type QuickProcessor } from './quick-processors.js';
export type Message = Delivery & { value: Buffer | null; key: Buffer | null; timestamp: string; headers?: unknown };
export type Dependencies = {
  source: SourceSubscription;
  quickProcessors?: readonly QuickProcessor[];
  ingest: (event: OsintEvent, delivery: Delivery, eventHash: string) => Promise<unknown>;
  quarantine: (record: Record<string, unknown>) => Promise<void>;
  commit: (message: Delivery) => Promise<void>;
};
export async function processMessage(message: Message, dependencies: Dependencies): Promise<void> {
  let event: OsintEvent;
  let eventHash: string;
  try {
    if (message.topic !== dependencies.source.topic || message.value === null) throw new Error('Invalid message boundary');
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(message.value));
    eventHash = hash(value);
    event = runQuickProcessors(adapt(value, dependencies.source), dependencies.quickProcessors ?? []);
  } catch {
    await quarantine('invalid-event');
    await dependencies.commit(message);
    return;
  }
  try { await dependencies.ingest(event, message, eventHash); }
  catch (error) {
    if (!(error instanceof EventConflictError)) throw error;
    await quarantine(error.message);
  }
  await dependencies.commit(message);
  async function quarantine(reason: string): Promise<void> {
    await dependencies.quarantine({ reason, streamId: message.streamId, topic: message.topic, partition: message.partition,
      offset: message.offset, timestamp: message.timestamp, processorVersion: PROCESSOR_VERSION,
      valueBase64: message.value?.toString('base64') ?? null,
      keyBase64: message.key?.toString('base64') ?? null, headers: message.headers ?? {} });
  }
}
