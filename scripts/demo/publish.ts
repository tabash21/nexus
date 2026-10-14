import { randomUUID } from 'node:crypto';
import { createKafka } from '@nexus/kafka';
import { collectorEventSchema, itemIdentity, sourceSubscriptions } from '@nexus/contracts';

const source = sourceSubscriptions().find(source => source.platform === (process.env.DEMO_PLATFORM ?? 'telegram') && source.mode === 'real');
if (!source) throw new Error('DEMO_PLATFORM must be configured as a real source');

const eventId = randomUUID();
const nowSec = Math.floor(Date.now() / 1000);
let payload: unknown;
let messageKey: string;

if (source.adapter === 'telegram.v1') {
  const channelId = '1406113886';
  const messageId = Math.floor(Date.now() / 1000) * 100 + Math.floor(Math.random() * 100);
  const title = 'Nexus demo Telegram item';
  const text = 'First verified #OSINT item in Nexus pipeline.';
  const url = `https://t.me/nexus_intel/${messageId}`;
  const fullMessage = `${title}\n\n${text}\n\n${url}`;

  payload = {
    id: messageId,
    peerId: { channelId, className: 'PeerChannel' },
    date: nowSec,
    message: fullMessage,
    className: 'Message',
    flags: 17536,
    post: true,
    views: 85,
    forwards: 5,
    postAuthor: 'Nexus Intel Desk',
    entities: [
      { offset: 0, length: title.length, className: 'MessageEntityBold' },
      { offset: fullMessage.indexOf(url), length: url.length, className: 'MessageEntityUrl', url },
    ],
    eventId,
  };
  messageKey = `${source.platform}:${channelId}:${messageId}`;
} else {
  const event = collectorEventSchema.parse({
    schemaVersion: 'provisional.v1',
    eventId,
    platform: source.platform,
    provider: 'demo',
    collector: 'nexus-demo',
    source: { id: 'demo-channel', kind: 'channel', name: 'Demo source' },
    observedAt: new Date(nowSec * 1000).toISOString(),
    item: { nativeId: 'article-001', title: 'Nexus demo item', text: 'First #OSINT item in Nexus.', language: 'en' },
  });
  payload = event;
  messageKey = itemIdentity({ ...event, realityId: source.realityId }).itemId;
}

const producer = createKafka('nexus-demo').producer();
await producer.connect();
try {
  await producer.send({ topic: source.topic, acks: -1, messages: [{ key: messageKey, value: JSON.stringify(payload) }] });
  console.log(`Published event ${eventId} to ${source.topic} using ${source.adapter}`);
} finally {
  await producer.disconnect();
}
