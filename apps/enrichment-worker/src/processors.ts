import type { ClaimedJob, ProcessorResult } from '@nexus/database';

export interface ProcessorContext {
  job: ClaimedJob;
  signal: AbortSignal;
}

export interface EnrichmentProcessor {
  readonly jobType: string;
  readonly version: string;
  readonly inputs: readonly ('text' | 'title')[];
  process(context: ProcessorContext): Promise<ProcessorResult>;
}

/** Lifecycle diagnostic. No classification, summary, or other analysis is inferred. */
export const testProcessor: EnrichmentProcessor = {
  jobType: 'test', version: 'test.v1', inputs: ['text', 'title'],
  async process({ job }): Promise<ProcessorResult> {
    return { values: { kind: 'lifecycle-diagnostic', inputHash: job.input_hash,
      eventId: job.event_id } };
  },
};
