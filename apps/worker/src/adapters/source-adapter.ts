import type { CollectorEvent, SourceSubscription } from '@nexus/contracts';

/**
 * Interface that all source-specific adapters must implement.
 * Each adapter knows how to validate its source JSON schema from Kafka
 * and map it into the canonical CollectorEvent for ingestion.
 */
export interface SourceAdapter<TRaw = unknown> {
  /** The unique name of this adapter, e.g. 'telegram.v1', 'provisional.v1' */
  readonly name: string;

  /** The primary platform this adapter targets, e.g. 'telegram', 'x' */
  readonly platform?: string;

  /**
   * Validates and parses the raw Kafka JSON payload into a canonical CollectorEvent.
   * Throws if validation fails.
   */
  parse(payload: unknown, source: SourceSubscription): CollectorEvent;

  /**
   * Optional heuristic to check whether this adapter can handle the given payload.
   */
  supports?(payload: unknown, source: SourceSubscription): boolean;
}
