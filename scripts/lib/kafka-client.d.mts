import type { Kafka, KafkaConfig } from 'kafkajs';
export function kafkaOptions(env?: NodeJS.ProcessEnv): Pick<KafkaConfig, 'brokers' | 'ssl' | 'sasl'>;
export function createKafka(clientId: string, env?: NodeJS.ProcessEnv): Kafka;
