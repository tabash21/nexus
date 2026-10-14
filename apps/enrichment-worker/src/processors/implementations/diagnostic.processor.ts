import type { EnrichmentProcessor, ProcessorContext, ProcessorResult } from '../types.js';

/**
 * Lifecycle diagnostic processor (`test.v1`).
 * Records input provenance and pipeline lifecycle.
 * Produces no classification, summary, or analysis.
 */
export const testProcessor: EnrichmentProcessor = {
  jobType: 'test',
  version: 'test.v1',
  inputs: ['text', 'title'],
  metadata: {
    jobType: 'test',
    version: 'test.v1',
    name: 'Lifecycle Diagnostic',
    description: 'Verifies pipeline end-to-end receipt without performing production analysis',
    target: 'text',
  },
  async process({ job }: ProcessorContext): Promise<ProcessorResult> {
    return {
      values: {
        kind: 'lifecycle-diagnostic',
        inputHash: job.input_hash,
        eventId: job.event_id,
      },
    };
  },
};
