import avro from 'avsc';
import { createKafka } from './kafka-client.mjs';
const file = process.argv[2];
if (!file || !file.endsWith('.avro')) throw new Error('Usage: npm run replay -- path/to/downloaded-archive.avro');
const producer = createKafka('nexus-replay').producer();
await producer.connect();
let count = 0;
try {
  for await (const value of avro.createFileDecoder(file)) {
    if (!Buffer.isBuffer(value)) throw new Error('Expected a raw-bytes Avro archive from nexus-raw-s3');
    // Keep the original bytes and event ID. Invalid records will be quarantined by the worker.
    let key: string | undefined;
    try { const e = JSON.parse(value.toString('utf8')); key = e.source.id + ':' + e.document.externalId; } catch { /* Preserve malformed payloads too. */ }
    await producer.send({ topic: process.env.KAFKA_TOPIC ?? 'osint.raw.v1', acks: -1, messages: [{ key, value }] });
    count++;
  }
  console.log('Replayed ' + count + ' records; existing event receipts prevent duplicate processing.');
} finally { await producer.disconnect(); }
