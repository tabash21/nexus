import { Kafka, type KafkaConfig } from 'kafkajs';

type KafkaEnv = Record<string, string | undefined>;
type SaslMechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512';
const MECHANISMS: SaslMechanism[] = ['plain', 'scram-sha-256', 'scram-sha-512'];

export function kafkaOptions(env: KafkaEnv = process.env): Pick<KafkaConfig, 'brokers' | 'ssl' | 'sasl'> {
  const protocol = env.KAFKA_SECURITY_PROTOCOL || 'PLAINTEXT';
  if (!['PLAINTEXT', 'SSL', 'SASL_SSL', 'SASL_PLAINTEXT'].includes(protocol)) {
    throw new Error('Unsupported KAFKA_SECURITY_PROTOCOL');
  }
  const brokers = (env.KAFKA_BROKERS || 'localhost:9092').split(',').map(value => value.trim());
  if (brokers.some(value => !value)) throw new Error('KAFKA_BROKERS contains an empty address');
  const options: Pick<KafkaConfig, 'brokers' | 'ssl' | 'sasl'> = { brokers, ssl: protocol === 'SSL' || protocol === 'SASL_SSL' };
  if (protocol.startsWith('SASL_')) {
    const mechanism = (env.KAFKA_SASL_MECHANISM || 'PLAIN').toLowerCase();
    if (!MECHANISMS.includes(mechanism as SaslMechanism)) {
      throw new Error('Supported Kafka SASL mechanisms: PLAIN, SCRAM-SHA-256, SCRAM-SHA-512');
    }
    if (!env.KAFKA_SASL_USERNAME || !env.KAFKA_SASL_PASSWORD) {
      throw new Error('SASL requires KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD');
    }
    const credentials = { username: env.KAFKA_SASL_USERNAME, password: env.KAFKA_SASL_PASSWORD };
    options.sasl = mechanism === 'plain' ? { mechanism, ...credentials }
      : mechanism === 'scram-sha-256' ? { mechanism, ...credentials } : { mechanism: 'scram-sha-512', ...credentials };
  }
  return options;
}

export function createKafka(clientId: string, env: KafkaEnv = process.env): Kafka {
  return new Kafka({ clientId, ...kafkaOptions(env), retry: { retries: 8 } });
}
