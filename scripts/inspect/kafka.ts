import { Kafka } from 'kafkajs';
import { kafkaOptions } from '@nexus/kafka';
import type { SourceSubscription } from '@nexus/contracts';
import { toBigInt } from '../../packages/database/src/ingestion/bigint.js';

/** Metadata and existing offsets only: never joins a group or commits an offset. */
export async function inspectKafka(source: SourceSubscription | undefined, sources: readonly SourceSubscription[]) {
  const kafka = new Kafka({
    clientId: 'nexus-news-inspector',
    ...kafkaOptions(),
    connectionTimeout: 3000,
    requestTimeout: 5000,
    retry: { retries: 0 },
    logLevel: 0,
  });
  const admin = kafka.admin();
  try {
    await admin.connect();
    const availableTopics = new Set(await admin.listTopics());
    const missingSourceTopics = sources.filter(entry => !availableTopics.has(entry.topic)).map(entry => entry.topic);
    const topics = [
      source?.topic ?? 'raw.news.v1',
      process.env.KAFKA_SILVER_TOPIC ?? 'items.silver',
      process.env.KAFKA_DLQ_TOPIC ?? 'osint.quarantine.v1',
    ];
    const groups = [source?.groupId, process.env.KAFKA_SILVER_GROUP_ID ?? 'nexus-silver-writer-v1'].filter(
      (group): group is string => group !== undefined,
    );
    const topicResults = await Promise.allSettled(topics.map(topic => admin.fetchTopicOffsets(topic)));
    const offsets = new Map(
      topicResults.flatMap((result, index) =>
        result.status === 'fulfilled' ? [[topics[index]!, result.value] as const] : [],
      ),
    );
    const groupResults = await Promise.allSettled(
      groups.map(async groupId => {
        const topic = groupId === source?.groupId ? topics[0]! : topics[1]!;
        const [{ groups: details }, committed] = await Promise.all([
          admin.describeGroups([groupId]),
          admin.fetchOffsets({ groupId, topics: [topic] }),
        ]);
        return {
          groupId,
          state: details[0]?.state,
          members: details[0]?.members.length,
          topics: committed.map(entry => ({
            topic: entry.topic,
            partitions: entry.partitions.map(partition => {
              const high = toBigInt(
                offsets.get(entry.topic)?.find(value => value.partition === partition.partition)?.high,
              );
              const committedOffset = toBigInt(partition.offset)!;
              const lag = high !== undefined && committedOffset >= 0n ? high - committedOffset : undefined;
              return {
                partition: partition.partition,
                committedOffset: partition.offset,
                // Commits can advance beyond the earlier watermark sample while the worker is active.
                lag: lag === undefined ? null : (lag < 0n ? 0n : lag).toString(),
              };
            }),
          })),
        };
      }),
    );
    return {
      missingSourceTopics,
      topics: topicResults.map((result, index) => ({
        topic: topics[index],
        ...(result.status === 'fulfilled' ? { partitions: result.value } : { error: String(result.reason) }),
      })),
      groups: groupResults.map((result, index) =>
        result.status === 'fulfilled' ? result.value : { groupId: groups[index], error: String(result.reason) },
      ),
    };
  } finally {
    await admin.disconnect();
  }
}
