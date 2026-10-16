import { createKafka } from '@nexus/kafka';
import { sourceSubscriptions } from '@nexus/contracts';
import { pathToFileURL } from 'node:url';

export async function setupTopics(env = process.env) {
  const partitions = Number(env.KAFKA_TOPIC_PARTITIONS || 3);
  const replicas = Number(env.KAFKA_TOPIC_REPLICATION_FACTOR || 1);
  if (!Number.isInteger(partitions) || partitions < 1 || !Number.isInteger(replicas) || replicas < 1) {
    throw new Error('Kafka topic partition and replication counts must be positive integers');
  }
  const admin = createKafka('nexus-setup', env).admin();
  await admin.connect();
  try {
    await admin.createTopics({ waitForLeaders: true, topics: [
      ...sourceSubscriptions(env).map(source => ({ topic: source.topic, numPartitions: partitions, replicationFactor: replicas,
        configEntries: [{ name: 'retention.ms', value: '604800000' }] })),
      { topic: env.KAFKA_DLQ_TOPIC || 'osint.quarantine.v1', numPartitions: partitions, replicationFactor: replicas,
        configEntries: [{ name: 'retention.ms', value: '2592000000' }] },
    ] });
    console.log('Kafka topics ready');
  } finally { await admin.disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await setupTopics();
