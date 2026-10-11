import { Kafka } from 'kafkajs';
const kafka = new Kafka({ clientId: 'nexus-setup', brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',') });
const admin = kafka.admin();
await admin.connect();
try {
  await admin.createTopics({ waitForLeaders: true, topics: [
    { topic: process.env.KAFKA_TOPIC ?? 'osint.raw.v1', numPartitions: 3, replicationFactor: 1,
      configEntries: [{ name: 'retention.ms', value: '604800000' }] },
    { topic: process.env.KAFKA_DLQ_TOPIC ?? 'osint.quarantine.v1', numPartitions: 3, replicationFactor: 1,
      configEntries: [{ name: 'retention.ms', value: '2592000000' }] },
  ] });
  console.log('Local topics ready (7-day raw / 30-day quarantine retention)');
} finally { await admin.disconnect(); }
