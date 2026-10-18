export interface ClaimedJob {
  job_id: string;
  item_id: string;
  content_revision: string;
  event_id: string;
  job_type: string;
  processor_version: string;
  input_hash: string;
  claim_token: string;
  attempts: number;
  raw_bytes: Buffer;
  raw_payload: Record<string, unknown>;
  platform: string;
  // Silver layer canonical fields for topic-agnostic processors
  title?: string | null;
  content_text?: string;
  lang?: string | null;
  url?: string | null;
  published_at?: string;
  source_id?: string;
  author_id?: string | null;
}

export interface ProcessorResult {
  values: Record<string, unknown>;
}

export interface JobStatusStat {
  status: string;
  count: string;
  oldest: string | null;
}
