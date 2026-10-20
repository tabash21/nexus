import type { MediaJobRow } from '../schema/index.js';

export const MEDIA_PROCESSOR_VERSION = 'media-ocr.v1';

export interface ClaimedMediaJob extends MediaJobRow {
  claim_token: string;
  reality_id: number;
}

export type MediaWriteResult = 'accepted' | 'stale' | 'lost';

export type MediaOutcome =
  | 'text'
  | 'no_text'
  | 'missing_url'
  | 'missing'
  | 'forbidden_or_expired'
  | 'unsafe_url'
  | 'unsupported_format'
  | 'unreadable'
  | 'download_limit'
  | 'pixel_limit'
  | 'page_limit'
  | 'output_limit'
  | 'temporary_limit'
  | 'timeout'
  | 'transient'
  | 'infrastructure'
  | 'cancelled';

export interface MediaFailure {
  outcome: MediaOutcome;
  retryable: boolean;
}
