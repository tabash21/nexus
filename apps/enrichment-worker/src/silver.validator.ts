import type { KafkaMessage } from 'kafkajs';
import {
  itemIdentity,
  silverObservationSchema,
  sourceReality,
  type SilverObservation,
  type SourceSubscription,
} from '@nexus/contracts';
import { EventConflictError } from '@nexus/database';
import { extractMetaFromSilver, type ExtractedEntity } from './processors/implementations/entity-mentions.processor.js';

export class InvalidSilverError extends Error {}

export interface ParsedSilverMessage {
  silver: SilverObservation;
  source: SourceSubscription;
}

export function extractMetaInfo(message: ParsedSilverMessage): ExtractedEntity[] {
  return extractMetaFromSilver(message.silver);
}

/**
 * Validates the raw Kafka message against the silver observation schema and asserts that:
 * 1. The message payload is non-empty and valid JSON conforming to silverObservationSchema.
 * 2. The source topic corresponds to a configured raw topic with matching platform and reality.
 * 3. The Kafka record key matches the derived canonical itemId.
 */
export function parseSilverMessage(message: KafkaMessage, sources: readonly SourceSubscription[]): ParsedSilverMessage {
  if (!message.value) {
    throw new InvalidSilverError('Empty silver message');
  }

  const silver = silverObservationSchema.parse(JSON.parse(message.value.toString('utf8')));
  const source = sources.find(s => s.topic === silver.sourceDelivery.topic);
  if (!source || source.platform !== silver.event.platform || sourceReality(source) !== silver.event.realityId) {
    throw new InvalidSilverError('Silver source and reality do not match a configured raw topic');
  }

  if (message.key?.toString('utf8') !== itemIdentity(silver.event).itemId) {
    throw new InvalidSilverError('Silver item key does not match its event');
  }

  return { silver, source };
}

/**
 * Returns true if the error represents an invalid, conflicting, or malformed record
 * that should be routed to quarantine rather than crashing the worker.
 */
export function isQuarantinable(error: unknown): error is Error {
  return (
    error instanceof EventConflictError ||
    error instanceof InvalidSilverError ||
    error instanceof SyntaxError ||
    (error instanceof Error && error.name === 'ZodError')
  );
}
