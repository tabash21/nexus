import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hash, itemIdentity, silverObservationSchema } from '@nexus/contracts';
import { EnrichmentService } from '../apps/enrichment-worker/dist/enrichment.service.js';
import { ingest as persist } from '@nexus/database';
import { createItemTestDatabase } from './helpers/item-database.js';
import type { EnrichmentResources } from '../apps/enrichment-worker/dist/resources.js';
import { event, source } from './fixtures.js';

let f: Awaited<ReturnType<typeof createItemTestDatabase>>;
beforeAll(async () => { f = await createItemTestDatabase(); }, 120000);
beforeEach(async () => { await f.pg.exec('TRUNCATE core.source,core.author,ingest.ingest_events,core.item CASCADE'); });
afterAll(async () => { await f?.pg.close(); });

function harness() {
  const observation = event();
  const silver = silverObservationSchema.parse({ stageVersion: 'silver.v1', event: observation,
    eventHash: hash(observation), rawSha256: 'a'.repeat(64), rawUri: 's3://test/raw/0#L1',
    sourceDelivery: { streamId: 'source', topic: source.topic, partition: 0, offset: '0' } });
  type Payload = { topic: string; partition: number; message: { key: Buffer; value: Buffer; offset: string };
    heartbeat: () => Promise<void> };
  let handle: (payload: Payload) => Promise<void> = async () => { throw new Error('Consumer was not started'); };
  const consumer = { connect: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined), commitOffsets: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockImplementation(async (options: { eachMessage: (payload: Payload) => Promise<void> }) => {
      handle = options.eachMessage;
    }) };
  const producer = { connect: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined) };
  // Delegates to the real transactional ingest so gold messages are built from genuine committed rows.
  const ingest = vi.fn((...args: Parameters<typeof persist> extends [unknown, ...infer Rest] ? Rest : never) =>
    persist(f.db, ...args));
  const resources = { pool: { end: vi.fn().mockResolvedValue(undefined) }, consumer, producer, ingest,
    ready: vi.fn().mockResolvedValue(undefined), streamId: 'silver', silverTopic: 'items.silver', goldTopic: 'items.gold',
    quarantineTopic: 'osint.quarantine.v1', sources: [source] };
  const service = new EnrichmentService(resources as unknown as EnrichmentResources);
  const receive = (value: unknown = silver, key = itemIdentity(observation).itemId) => handle({
    topic: 'items.silver', partition: 0, message: { key: Buffer.from(key),
      value: Buffer.from(JSON.stringify(value)), offset: '7' }, heartbeat: async () => undefined });
  return { silver, service, receive, resources, consumer, producer, ingest };
}

describe('silver writer acknowledgement boundary', () => {
  it('commits only after the PostgreSQL transaction resolves', async () => {
    const h = harness();
    await h.service.onModuleInit();
    await h.receive();
    expect(h.ingest).toHaveBeenCalledWith(h.silver.event,
      { streamId: 'silver', topic: 'items.silver', partition: 0, offset: '7' },
      h.silver.eventHash, h.silver.rawUri, { contentVersionAt: undefined, legacySourceTopic: undefined });
    expect(h.consumer.commitOffsets).toHaveBeenCalledWith([{ topic: 'items.silver', partition: 0, offset: '8' }]);
    expect(h.ingest.mock.invocationCallOrder[0]).toBeLessThan(h.consumer.commitOffsets.mock.invocationCallOrder[0]!);
    await h.service.onApplicationShutdown();
  });
  it('publishes the committed item to the gold topic between the transaction and the offset commit', async () => {
    const h = harness();
    await h.service.onModuleInit();
    await h.receive();
    const itemId = itemIdentity(h.silver.event).itemId;
    expect(h.producer.send).toHaveBeenCalledOnce();
    const [record] = h.producer.send.mock.calls[0] as [{ topic: string; acks: number;
      messages: { key: string; value: string }[] }];
    expect(record).toMatchObject({ topic: 'items.gold', acks: -1 });
    expect(record.messages[0]?.key).toBe(itemId);
    expect(JSON.parse(record.messages[0]!.value)).toMatchObject({ stageVersion: 'gold.v1',
      eventId: h.silver.event.eventId, item: { itemId, rawUri: h.silver.rawUri, contentRevision: '1' } });
    const [ingested, sent, committed] = [h.ingest, h.producer.send, h.consumer.commitOffsets]
      .map(mock => mock.mock.invocationCallOrder[0]!);
    expect(ingested).toBeLessThan(sent!);
    expect(sent).toBeLessThan(committed!);
    await h.service.onApplicationShutdown();
  });
  it('republishes a duplicate redelivery so a crash before the gold send is recovered', async () => {
    const h = harness();
    await h.service.onModuleInit();
    await h.receive();
    await h.receive();
    expect(h.producer.send).toHaveBeenCalledTimes(2);
    const values = h.producer.send.mock.calls.map(call =>
      (call[0] as { messages: { value: string }[] }).messages[0]!.value);
    expect(values[1]).toBe(values[0]);
    expect(h.consumer.commitOffsets).toHaveBeenCalledTimes(2);
    await h.service.onApplicationShutdown();
  });
  it('does not acknowledge when gold publication fails', async () => {
    const h = harness(); h.producer.send.mockRejectedValue(new Error('broker unavailable'));
    await h.service.onModuleInit();
    await expect(h.receive()).rejects.toThrow('broker unavailable');
    expect(h.ingest).toHaveBeenCalledOnce();
    expect(h.consumer.commitOffsets).not.toHaveBeenCalled();
    await h.service.onApplicationShutdown();
  });
  it('does not acknowledge a database outage', async () => {
    const h = harness(); h.ingest.mockRejectedValue(new Error('database unavailable'));
    await h.service.onModuleInit();
    await expect(h.receive()).rejects.toThrow('database unavailable');
    expect(h.consumer.commitOffsets).not.toHaveBeenCalled();
    expect(h.producer.send).not.toHaveBeenCalled();
    await h.service.onApplicationShutdown();
  });
  it('forwards content version and legacy source provenance to the transaction', async () => {
    const h = harness();
    await h.service.onModuleInit();
    await h.receive({ ...h.silver, contentVersionAt: h.silver.event.observedAt, legacyReplay: true });
    expect(h.ingest).toHaveBeenCalledWith(h.silver.event, expect.any(Object), h.silver.eventHash,
      h.silver.rawUri, { contentVersionAt: h.silver.event.observedAt, legacySourceTopic: source.topic });
    await h.service.onApplicationShutdown();
  });
  it('quarantines an invalid silver boundary before committing', async () => {
    const h = harness();
    await h.service.onModuleInit();
    await h.receive(h.silver, 'wrong-item');
    expect(h.ingest).not.toHaveBeenCalled();
    expect(h.producer.send).toHaveBeenCalledOnce();
    expect(h.producer.send).toHaveBeenCalledWith(expect.objectContaining({ topic: 'osint.quarantine.v1' }));
    expect(h.consumer.commitOffsets).toHaveBeenCalledOnce();
    await h.service.onApplicationShutdown();
  });
  it('does not acknowledge when quarantine publication fails', async () => {
    const h = harness(); h.producer.send.mockRejectedValue(new Error('broker unavailable'));
    await h.service.onModuleInit();
    await expect(h.receive(h.silver, 'wrong-item')).rejects.toThrow('broker unavailable');
    expect(h.consumer.commitOffsets).not.toHaveBeenCalled();
    await h.service.onApplicationShutdown();
  });
});
