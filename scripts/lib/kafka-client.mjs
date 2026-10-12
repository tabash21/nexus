import { Kafka } from 'kafkajs';

export function kafkaOptions(env = process.env) {
  const protocol = env.KAFKA_SECURITY_PROTOCOL || 'PLAINTEXT';
  if (!['PLAINTEXT', 'SSL', 'SASL_SSL', 'SASL_PLAINTEXT'].includes(protocol)) {
    throw new Error('Unsupported KAFKA_SECURITY_PROTOCOL');
  }
  const options = {
    brokers: (env.KAFKA_BROKERS || 'localhost:9092').split(',').map(value => value.trim()),
    ssl: protocol === 'SSL' || protocol === 'SASL_SSL',
  };
  if (options.brokers.some(value => !value)) throw new Error('KAFKA_BROKERS contains an empty address');
  if (protocol.startsWith('SASL_')) {
    const mechanism = (env.KAFKA_SASL_MECHANISM || 'PLAIN').toLowerCase();
    if (!['plain', 'scram-sha-256', 'scram-sha-512'].includes(mechanism)) {
      throw new Error('Supported Kafka SASL mechanisms: PLAIN, SCRAM-SHA-256, SCRAM-SHA-512');
    }
    if (!env.KAFKA_SASL_USERNAME || !env.KAFKA_SASL_PASSWORD) {
      throw new Error('SASL requires KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD');
    }
    options.sasl = { mechanism, username: env.KAFKA_SASL_USERNAME, password: env.KAFKA_SASL_PASSWORD };
  }
  return options;
}

export function createKafka(clientId, env = process.env) {
  return new Kafka({ clientId, ...kafkaOptions(env), retry: { retries: 8 } });
}

