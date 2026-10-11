import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../infra/connect/s3-sink.local.json', import.meta.url), 'utf8'));
config.topics = process.env.KAFKA_TOPIC ?? config.topics;
const endpoint = process.env.CONNECT_URL ?? 'http://localhost:8083';
const response = await fetch(endpoint + '/connectors/nexus-raw-s3/config', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config),
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error('Connector registration failed: ' + response.status + ' ' + await response.text());
console.log('Registered nexus-raw-s3. Check ' + endpoint + '/connectors/nexus-raw-s3/status for RUNNING tasks.');
