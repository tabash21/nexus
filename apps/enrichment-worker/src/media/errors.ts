import type { MediaFailure, MediaOutcome } from '@nexus/database';

export class MediaError extends Error implements MediaFailure {
  constructor(
    readonly outcome: MediaOutcome,
    readonly retryable = false,
  ) {
    super(outcome);
    this.name = 'MediaError';
  }
}

export function classifyMediaError(error: unknown, signal: AbortSignal): MediaFailure {
  if (error instanceof MediaError) return error;
  if (signal.aborted)
    return { outcome: signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled', retryable: true };
  return { outcome: 'infrastructure', retryable: true };
}
