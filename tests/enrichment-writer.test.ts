import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { hash, itemIdentity, silverObservationSchema } from '@nexus/contracts';
import { EnrichmentService } from '../apps/enrichment-worker/dist/enrichment.service.js';
import type { EnrichmentResources } from '../apps/enrichment-worker/dist/resources.js';
import { event, source } from './fixtures.js';

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
  const ingest = vi.fn().mockResolvedValue({ duplicate: false });
  const resources = { pool: { end: vi.fn().mockResolvedValue(undefined) }, consumer, producer, ingest,
    ready: vi.fn().mockResolvedValue(undefined), streamId: 'silver', silverTopic: 'items.silver',
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
      h.silver.eventHash, h.silver.rawUri, { contentVersionAt: undefined, legacySourceTopic: undefined,
        detectLanguage: expect.any(Function) });
    expect(h.consumer.commitOffsets).toHaveBeenCalledWith([{ topic: 'items.silver', partition: 0, offset: '8' }]);
    expect(h.ingest.mock.invocationCallOrder[0]).toBeLessThan(h.consumer.commitOffsets.mock.invocationCallOrder[0]!);
    await h.service.onApplicationShutdown();
  });
  it('passes the lang.v1 detector into the PostgreSQL transaction', async () => {
    const h = harness();
    await h.service.onModuleInit();
    await h.receive();
    const options = h.ingest.mock.calls[0]?.[4] as { detectLanguage: (input: { title: string | null; text: string }) => unknown };
    expect(options.detectLanguage({ title: null, text: 'The army announced this morning that roads have reopened' }))
      .toMatchObject({ lang: 'en' });
    expect(options.detectLanguage({ title: null, text: '' })).toEqual({ lang: null, confidence: null });
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
      h.silver.rawUri, { contentVersionAt: h.silver.event.observedAt, legacySourceTopic: source.topic,
        detectLanguage: expect.any(Function) });
    await h.service.onApplicationShutdown();
  });
  it('quarantines an invalid silver boundary before committing', async () => {
    const h = harness();
    await h.service.onModuleInit();
    await h.receive(h.silver, 'wrong-item');
    expect(h.ingest).not.toHaveBeenCalled();
    expect(h.producer.send).toHaveBeenCalledOnce();
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
