import type { EnrichmentProcessor } from './types.js';
import { testProcessor } from './implementations/diagnostic.processor.js';
import { sentimentProcessor } from './sentiment.js';

export class ProcessorRegistry {
  private readonly processors = new Map<string, EnrichmentProcessor>();

  constructor(
    initialProcessors: readonly EnrichmentProcessor[] = [
      testProcessor,
      sentimentProcessor,
    ],
  ) {
    for (const processor of initialProcessors) {
      this.register(processor);
    }
  }

  private key(jobType: string, version: string): string {
    return `${jobType}@${version}`;
  }

  register(processor: EnrichmentProcessor): this {
    this.processors.set(
      this.key(processor.jobType, processor.version),
      processor,
    );

    return this;
  }

  find(jobType: string, version: string): EnrichmentProcessor | undefined {
    return this.processors.get(this.key(jobType, version));
  }

  getAll(): EnrichmentProcessor[] {
    return Array.from(this.processors.values());
  }
}