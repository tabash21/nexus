import type { Admin } from 'kafkajs';

/** Kafka 4 can briefly return UNKNOWN_TOPIC_OR_PARTITION after topic creation. */
export async function createTestTopics(admin: Admin, topics: string[]): Promise<void> {
  await admin.createTopics({ waitForLeaders: false, topics: topics.map(topic => ({
    topic, numPartitions: 1, replicationFactor: 1,
  })) });
  const deadline = Date.now() + 30000;
  do {
    try {
      const metadata = await admin.fetchTopicMetadata({ topics });
      if (metadata.topics.length === topics.length && metadata.topics.every(topic =>
        topic.partitions.length > 0 && topic.partitions.every(partition => partition.leader >= 0))) return;
    } catch (error) {
      if (!(error instanceof Error) || !('type' in error) ||
        !['UNKNOWN_TOPIC_OR_PARTITION', 'LEADER_NOT_AVAILABLE'].includes(String(error.type))) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for test Kafka topics');
}
