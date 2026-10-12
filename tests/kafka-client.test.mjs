import { describe, expect, it } from 'vitest';
import { kafkaOptions } from '../scripts/kafka-client.mjs';

describe('Kafka connection settings', () => {
  it('keeps local plaintext defaults', () => {
    expect(kafkaOptions({})).toEqual({ brokers: ['localhost:9092'], ssl: false });
  });
  it.each(['PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512'])('supports injected %s credentials over TLS', mechanism => {
    expect(kafkaOptions({
      KAFKA_BROKERS: 'broker1:9093, broker2:9093', KAFKA_SECURITY_PROTOCOL: 'SASL_SSL',
      KAFKA_SASL_MECHANISM: mechanism, KAFKA_SASL_USERNAME: 'user', KAFKA_SASL_PASSWORD: 'password',
    })).toMatchObject({ brokers: ['broker1:9093', 'broker2:9093'], ssl: true,
      sasl: { mechanism: mechanism.toLowerCase(), username: 'user', password: 'password' } });
  });
  it('rejects SASL without credentials', () => {
    expect(() => kafkaOptions({ KAFKA_SECURITY_PROTOCOL: 'SASL_SSL' })).toThrow('SASL requires');
  });
});
