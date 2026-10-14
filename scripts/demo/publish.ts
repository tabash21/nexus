import { randomUUID } from 'node:crypto';
import { createKafka } from '@nexus/kafka';
import { collectorEventSchema, itemIdentity, sourceSubscriptions } from '@nexus/contracts';
const source = sourceSubscriptions().find(source => source.platform === (process.env.DEMO_PLATFORM ?? 'telegram') && source.mode === 'real');
if (!source) throw new Error('DEMO_PLATFORM must be configured as a real source');
const event = collectorEventSchema.parse({ schemaVersion: 'provisional.v1', eventId: randomUUID(),
  platform: source.platform, provider: 'demo', collector: 'nexus-demo',
  source: { id: 'demo-channel', kind: 'channel', name: 'Demo source' }, observedAt: new Date().toISOString(),
  item: { nativeId: 'article-001', title: 'Nexus demo item', text: 'First #OSINT item in Nexus.', language: 'en' },
});
const producer = createKafka('nexus-demo').producer();
await producer.connect();
try {
  await producer.send({ topic: source.topic, acks: -1, messages: [{ key: itemIdentity({ ...event, realityId: source.realityId }).itemId, value: JSON.stringify(event) }] });
  console.log('Published event ' + event.eventId + ' to ' + source.topic);
} finally { await producer.disconnect(); }
