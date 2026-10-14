import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKafka } from '@nexus/kafka';
import { sourceSubscriptions } from '@nexus/contracts';
import { WorkerService, createResources } from '../apps/worker/dist/worker.service.js';
import { collectorEvent, event } from './fixtures.js';
import { disposablePostgres } from './helpers/postgres.js';

const brokers = process.env.REALITY_KAFKA_BROKERS;
const url = process.env.INTEGRATION_DATABASE_URL;
describe.skipIf(!brokers || !url)('Worker-assigned reality through a real Kafka broker', () => {
  const prefix = 'nexus-reality-test-' + randomUUID().replaceAll('-', '');
  const platform = 'realitytest' + randomUUID().replaceAll('-', '');
  const sourceEnv = { KAFKA_PLATFORMS: platform, KAFKA_GROUP_ID: prefix };
  const config = sourceSubscriptions(sourceEnv);
  const topics = [...config.map(source => source.topic), prefix + '.quarantine'];
  const kafka = createKafka(prefix, { ...process.env, KAFKA_BROKERS: brokers });
  const admin = kafka.admin();
  const producer = kafka.producer();
  let database: Awaited<ReturnType<typeof disposablePostgres>> | undefined;
  let worker: WorkerService | undefined;
  let topicsCreated = false;

  beforeAll(async () => {
    await admin.connect();
    await admin.createTopics({ waitForLeaders: true, topics: topics.map(topic => ({
      topic, numPartitions: 1, replicationFactor: 1,
      configEntries: [{ name: 'retention.ms', value: '3600000' }],
    })) });
    topicsCreated = true;
    database = await disposablePostgres(url!);
    const env = { ...process.env, ...sourceEnv, DATABASE_URL: database.url, KAFKA_BROKERS: brokers,
      KAFKA_STREAM_ID: prefix, KAFKA_DLQ_TOPIC: topics[2], KAFKA_SOURCES: '' };
    expect(sourceSubscriptions(env).map(source => source.realityId)).toEqual([0, 1]);
    worker = new WorkerService(createResources(env), async () => { throw new Error('Reality test consumer crashed'); });
    await worker.onModuleInit();
    await producer.connect();
  }, 120000);

  afterAll(async () => {
    await worker?.onApplicationShutdown();
    await producer.disconnect();
    try {
      if (topicsCreated) {
        if (!topics.every(topic => topic === 'raw.' + platform + '.v1' || topic === 'sim.' + platform + '.v1' || topic === prefix + '.quarantine')) throw new Error('Unexpected test topic cleanup target');
        await admin.deleteGroups(config.map(source => source.groupId));
        await admin.deleteTopics({ topics });
      }
    } finally { await admin.disconnect(); await database?.close(); }
  }, 60000);

  it('persists reality 0 and 1 although neither message contains realityId', async () => {
    const real = { ...collectorEvent(event()), platform };
    const simulation = { ...real, eventId: randomUUID() };
    const bytes = [real, simulation].map(payload => Buffer.from(JSON.stringify(payload)));
    for (const value of bytes) expect(JSON.parse(value.toString())).not.toHaveProperty('realityId');
    await producer.send({ topic: topics[0]!, acks: -1, messages: [{ value: bytes[0]! }, { value: bytes[0]! }] });
    await producer.send({ topic: topics[1]!, acks: -1, messages: [{ value: bytes[1]! }] });

    const deadline = Date.now() + 60000;
    let count = 0;
    while (Date.now() < deadline) {
      const result = await database!.pool.query<{ count: number }>('SELECT count(*)::int AS count FROM ingest.deliveries');
      count = result.rows[0]?.count ?? 0;
      if (count === 3) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    expect(count).toBe(3);
    const items = await database!.pool.query<{ reality_id: number; current_event_id: string }>(
      'SELECT reality_id,current_event_id FROM core.item ORDER BY reality_id');
    expect(items.rows).toEqual([{ reality_id: 0, current_event_id: real.eventId }, { reality_id: 1, current_event_id: simulation.eventId }]);
    const receipts = await database!.pool.query<{ reality_id: number }>('SELECT reality_id FROM ingest.processing_receipts ORDER BY reality_id');
    expect(receipts.rows).toEqual([{ reality_id: 0 }, { reality_id: 1 }]);
  }, 90000);
});
