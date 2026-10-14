import { createHash } from 'node:crypto';
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

/**
 * Generates a deterministic UUID (RFC-4122 v5 variant) from a platform and native identity.
 * This ensures that replays and retries of the same raw message always produce the exact
 * same eventId for database idempotency.
 */
export function deterministicEventId(platform: string, sourceId: string, nativeId: string | number): string {
  const hash = createHash('sha256').update(`${platform}:${sourceId}:${nativeId}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '5' + hash.slice(13, 16),
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-');
}

/**
 * Extensible registry managing source adapters for all platforms.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, SourceAdapter>();

  /**
   * Registers a new SourceAdapter.
   */
  register(adapter: SourceAdapter): this {
    this.adapters.set(adapter.name, adapter);
    if (adapter.platform && !this.adapters.has(adapter.platform)) {
      this.adapters.set(adapter.platform, adapter);
    }
    return this;
  }

  /**
   * Gets an adapter by name or platform.
   */
  get(nameOrPlatform: string): SourceAdapter | undefined {
    return this.adapters.get(nameOrPlatform);
  }

  /**
   * Resolves the best-matching adapter for a given payload and source subscription.
   */
  resolve(payload: unknown, source: SourceSubscription): SourceAdapter {
    // 1. Try explicit adapter name if registered
    if (source.adapter && this.adapters.has(source.adapter)) {
      const adapter = this.adapters.get(source.adapter)!;
      if (!adapter.supports || adapter.supports(payload, source)) {
        return adapter;
      }
    }

    // 2. Check if an adapter's `supports` check matches this payload
    for (const adapter of this.adapters.values()) {
      if (adapter.supports?.(payload, source)) {
        return adapter;
      }
    }

    // 3. Fallback by platform name
    if (source.platform && this.adapters.has(source.platform)) {
      return this.adapters.get(source.platform)!;
    }

    // 4. Fallback to adapter specified on source
    if (source.adapter && this.adapters.has(source.adapter)) {
      return this.adapters.get(source.adapter)!;
    }

    throw new Error(`No adapter registered for source "${source.platform}" with adapter "${source.adapter}"`);
  }
}
