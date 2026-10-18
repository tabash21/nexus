import { createKafka, DEFAULT_QUARANTINE_TOPIC, DEFAULT_SILVER_TOPIC } from '@nexus/kafka';
import { sourceSubscriptions, type SourceSubscription } from '@nexus/contracts';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { Consumer, Producer } from 'kafkajs';

export interface WorkerConsumer {
  source: SourceSubscription;
  consumer: Consumer;
}

export interface WorkerResources {
  streamId: string;
  quarantineTopic: string;
  silverTopic: string;
  rawBucket: string;
  consumers: WorkerConsumer[];
  producer: Producer;
  s3: S3Client;
  ready(): Promise<void>;
}

export function createResources(env: NodeJS.ProcessEnv = process.env): WorkerResources {
  if (!env.S3_BUCKET || !env.KAFKA_STREAM_ID) {
    throw new Error('S3_BUCKET and KAFKA_STREAM_ID are required');
  }

  const kafka = createKafka('nexus-worker', env);
  const sources = sourceSubscriptions(env);
  const s3 = new S3Client({
    region: env.S3_REGION ?? 'us-east-1',
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
  });

  return {
    streamId: env.KAFKA_STREAM_ID,
    quarantineTopic: env.KAFKA_DLQ_TOPIC ?? DEFAULT_QUARANTINE_TOPIC,
    silverTopic: env.KAFKA_SILVER_TOPIC ?? DEFAULT_SILVER_TOPIC,
    rawBucket: env.S3_BUCKET,
    consumers: sources.map(source => ({
      source,
      consumer: kafka.consumer({ groupId: source.groupId, sessionTimeout: 60000 }),
    })),
    producer: kafka.producer({ idempotent: true, maxInFlightRequests: 1 }),
    s3,
    ready: async () => {
      await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    },
  };
}
