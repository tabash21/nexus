import type { ClaimedJob, ItemLanguage, LanguageInput, ProcessorResult } from '@nexus/database';

export type { ProcessorResult, ClaimedJob, ItemLanguage, LanguageInput };

/**
 * Inline language detection run by the silver writer inside the PostgreSQL ingest transaction.
 * Must be pure and deterministic: the same title and text always yield the same result.
 */
export interface LanguageDetector {
  detect(input: LanguageInput): ItemLanguage;
}

/**
 * Metadata declaring processor identity, version, and trigger targets.
 */
export interface ProcessorMetadata {
  readonly jobType: string;
  readonly version: string;
  readonly name?: string;
  readonly description?: string;
  /** Primary target: text, media, metadata, or all */
  readonly target?: 'text' | 'media' | 'all';
  /** Supported platform filters: ['*'] for all, or specific platforms like ['telegram', 'twitter'] */
  readonly supportedPlatforms?: readonly string[];
}

/**
 * Standard execution context provided to enrichment processors.
 * Combines claimed job state, normalized Silver item fields, Bronze raw payloads, and cancellation signal.
 */
export interface EnrichmentTaskContext<TRaw = Record<string, unknown>> {
  readonly job: ClaimedJob;
  readonly signal: AbortSignal;
  /** Normalized Silver layer representation for topic-agnostic processors */
  readonly item: {
    readonly itemId: string;
    readonly platform: string;
    readonly title: string | null;
    readonly text: string;
    readonly lang: string | null;
    readonly url: string | null;
    readonly publishedAt?: string;
    readonly sourceId?: string;
    readonly authorId?: string | null;
  };
  /** Raw Bronze snapshot for source-specific processors */
  readonly raw: {
    readonly payload: TRaw;
    readonly bytes: Buffer;
  };
}

/**
 * Legacy context interface preserved for backward compatibility.
 */
export interface ProcessorContext {
  job: ClaimedJob;
  signal: AbortSignal;
}

/**
 * Core interface that every enrichment processor implements.
 */
export interface EnrichmentProcessor<TRaw = Record<string, unknown>> {
  readonly jobType: string;
  readonly version: string;
  readonly inputs?: readonly ('text' | 'title')[];
  readonly metadata?: ProcessorMetadata;
  supports?(platform: string): boolean;
  process(context: ProcessorContext | EnrichmentTaskContext<TRaw>): Promise<ProcessorResult>;
}
