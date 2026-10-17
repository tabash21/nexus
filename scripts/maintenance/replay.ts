import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import avro from 'avsc';
import { collectorEventSchema, itemIdentity, sourceSubscriptions } from '@nexus/contracts';
import { createKafka } from '@nexus/kafka';
import type { IHeaders } from 'kafkajs';

const file = process.argv[2];
const topic = process.argv[3] ?? process.env.REPLAY_TOPIC;
if (!file || !topic || (!file.endsWith('.avro') && !file.endsWith('.jsonl.gz'))) {
  throw new Error('Usage: npm run replay -- archive.avro|archive.jsonl.gz original-platform-topic');
}
const source = sourceSubscriptions().find(candidate => candidate.topic === topic);
if (!source) throw new Error('Replay topic must be registered in KAFKA_SOURCES/KAFKA_PLATFORMS');
const producer = createKafka('nexus-replay').producer();
await producer.connect();
let count = 0;
try {
  if (file.endsWith('.avro')) {
    for await (const value of avro.createFileDecoder(file)) {
      if (!Buffer.isBuffer(value)) throw new Error('Expected a raw-bytes Avro archive');
      let key: string | undefined;
      try { key = itemIdentity({ ...collectorEventSchema.parse(JSON.parse(value.toString('utf8'))), realityId: source.realityId }).itemId; }
      catch { /* Malformed source records retain their original bytes. */ }
      await producer.send({ topic, acks: -1, messages: [{ key, value, headers: { 'nexus-legacy-replay': '1' } }] });
      count++;
    }
  } else {
    const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) {
      const record: unknown = JSON.parse(line);
      if (!record || typeof record !== 'object') throw new Error('Invalid raw archive record');
      const raw = record as Record<string, unknown>;
      if (raw.topic !== topic || typeof raw.streamId !== 'string' || typeof raw.partition !== 'number' ||
          typeof raw.offset !== 'string' || typeof raw.timestamp !== 'string' ||
          (raw.valueBase64 !== null && typeof raw.valueBase64 !== 'string')) {
        throw new Error('Raw archive coordinates or topic are invalid');
      }
      const original = { streamId: raw.streamId, topic, partition: raw.partition, offset: raw.offset };
      const value = raw.valueBase64 === null ? null : Buffer.from(raw.valueBase64 as string, 'base64');
      const key = typeof raw.keyBase64 === 'string' ? Buffer.from(raw.keyBase64, 'base64') : undefined;
      const archivedHeaders: IHeaders = {};
      if (raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)) {
        for (const [name, encoded] of Object.entries(raw.headers)) {
          if (typeof encoded === 'string') archivedHeaders[name] = Buffer.from(encoded, 'base64');
          else if (Array.isArray(encoded) && encoded.every(part => typeof part === 'string')) {
            archivedHeaders[name] = encoded.map(part => Buffer.from(part, 'base64'));
          }
        }
      }
      const replayOrigin = archivedHeaders['nexus-replay-origin'];
      await producer.send({ topic, acks: -1, messages: [{ key, value, timestamp: raw.timestamp,
        headers: { ...archivedHeaders, 'nexus-replay-origin': replayOrigin ?? JSON.stringify(original) } }] });
      count++;
    }
  }
  console.log(`Replayed ${count} original records to ${topic}`);
} finally { await producer.disconnect(); }
