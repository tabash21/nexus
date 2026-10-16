import avro from 'avsc';
import { collectorEventSchema, itemIdentity, sourceSubscriptions } from '@nexus/contracts';
import { createKafka } from '@nexus/kafka';
const file = process.argv[2];
const topic = process.argv[3] ?? process.env.REPLAY_TOPIC;
if (!file?.endsWith('.avro') || !topic) throw new Error('Usage: npm run replay -- archive.avro original-platform-topic');
const source = sourceSubscriptions().find(source => source.topic === topic);
if (!source) throw new Error('Replay topic must be registered in KAFKA_SOURCES/KAFKA_PLATFORMS');
const producer = createKafka('nexus-replay').producer();
await producer.connect();
let count = 0;
try {
  for await (const value of avro.createFileDecoder(file)) {
    if (!Buffer.isBuffer(value)) throw new Error('Expected a raw-bytes Avro archive from nexus-raw-s3');
    let key: string | undefined;
    try { key = itemIdentity({ ...collectorEventSchema.parse(JSON.parse(value.toString('utf8'))), realityId: source.realityId }).itemId; }
    catch { /* Preserve malformed payloads for quarantine on the explicitly selected topic. */ }
    await producer.send({ topic, acks: -1, messages: [{ key, value }] });
    count++;
  }
  console.log('Replayed ' + count + ' unchanged records to ' + topic);
} finally { await producer.disconnect(); }
