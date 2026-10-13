import { randomUUID } from 'node:crypto';
import { createKafka } from '../lib/kafka-client.mjs';
import { eventSchema } from '../../packages/contracts/src/index.js';
const event = eventSchema.parse({ schemaVersion: 1, eventId: randomUUID(),
  source: { id: 'demo', name: 'Demo source' }, observedAt: new Date().toISOString(),
  document: { externalId: 'article-001', url: 'https://example.com/article-001', title: 'Nexus demo document', text: 'First OSINT document in Nexus.', language: 'en', attributes: {} },
});
const producer = createKafka('nexus-demo').producer();
await producer.connect();
try {
  await producer.send({ topic: process.env.KAFKA_TOPIC ?? 'osint.raw.v1', acks: -1,
    messages: [{ key: event.source.id + ':' + event.document.externalId, value: JSON.stringify(event) }] });
  console.log('Published event ' + event.eventId);
} finally { await producer.disconnect(); }
