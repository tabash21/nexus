import type { SourceSubscription } from '@nexus/contracts';
import type { SourceAdapter } from './source-adapter.js';

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
