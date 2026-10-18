import { Kafka, type KafkaConfig, type SASLOptions } from 'kafkajs';

type KafkaEnv = Record<string, string | undefined>;
type SaslMechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512';
const MECHANISMS: readonly SaslMechanism[] = ['plain', 'scram-sha-256', 'scram-sha-512'];

function resolveSaslOptions(env: KafkaEnv): SASLOptions {
  const mechanism = (env.KAFKA_SASL_MECHANISM || 'PLAIN').toLowerCase() as SaslMechanism;
  if (!MECHANISMS.includes(mechanism)) {
    throw new Error('Supported Kafka SASL mechanisms: PLAIN, SCRAM-SHA-256, SCRAM-SHA-512');
  }
  if (!env.KAFKA_SASL_USERNAME || !env.KAFKA_SASL_PASSWORD) {
    throw new Error('SASL requires KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD');
  }

  const credentials = { username: env.KAFKA_SASL_USERNAME, password: env.KAFKA_SASL_PASSWORD };
  switch (mechanism) {
    case 'plain':
      return { mechanism: 'plain', ...credentials };
    case 'scram-sha-256':
      return { mechanism: 'scram-sha-256', ...credentials };
    case 'scram-sha-512':
      return { mechanism: 'scram-sha-512', ...credentials };
    default: {
      const exhaustiveCheck: never = mechanism;
      throw new Error(`Unhandled SASL mechanism: ${exhaustiveCheck}`);
    }
  }
}

export function kafkaOptions(env: KafkaEnv = process.env): Pick<KafkaConfig, 'brokers' | 'ssl' | 'sasl'> {
  const protocol = env.KAFKA_SECURITY_PROTOCOL || 'PLAINTEXT';
  if (!['PLAINTEXT', 'SSL', 'SASL_SSL', 'SASL_PLAINTEXT'].includes(protocol)) {
    throw new Error('Unsupported KAFKA_SECURITY_PROTOCOL');
  }

  const brokers = (env.KAFKA_BROKERS || 'localhost:9092').split(',').map(value => value.trim());
  if (brokers.some(value => !value)) {
    throw new Error('KAFKA_BROKERS contains an empty address');
  }

  return {
    brokers,
    ssl: protocol === 'SSL' || protocol === 'SASL_SSL',
    ...(protocol.startsWith('SASL_') ? { sasl: resolveSaslOptions(env) } : {}),
  };
}

export function createKafka(clientId: string, env: KafkaEnv = process.env): Kafka {
  return new Kafka({ clientId, ...kafkaOptions(env), retry: { retries: 8 } });
}
