export type TabType = 'containers' | 'kafka' | 'documents' | 's3';

export interface ContainerInfo {
  Command?: string;
  CreatedAt?: string;
  Health?: string;
  ID?: string;
  Image?: string;
  Name?: string;
  Ports?: string;
  Service?: string;
  State?: string;
  Status?: string;
  error?: string;
  details?: string;
}

export interface KafkaPartition {
  partition: number;
  offset: string;
  high?: string;
  low?: string;
}

export interface KafkaTopic {
  topic: string;
  partitions: KafkaPartition[];
}

export interface KafkaGroup {
  groupId: string;
  protocolType?: string;
  details?: {
    state?: string;
    protocolType?: string;
    members?: unknown[];
  };
}

export interface DocumentRow {
  id: string;
  source_id: string;
  external_id: string;
  title: string | null;
  url: string | null;
  language: string | null;
  content_hash: string | null;
  first_seen_at: string;
  last_seen_at: string;
  text_preview: string | null;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: string;
}

export interface TelemetryData {
  timestamp?: string;
  containers: ContainerInfo[];
  kafka?: {
    brokers?: string[];
    securityProtocol?: string;
    topics?: KafkaTopic[];
    groups?: KafkaGroup[];
    connected?: boolean;
    error?: string;
  };
  database?: {
    counts?: {
      sources_count?: number;
      events_count?: number;
      documents_count?: number;
      media_count?: number;
      receipts_count?: number;
      deliveries_count?: number;
    };
    documents?: DocumentRow[];
    connected?: boolean;
    error?: string;
  };
  s3?: {
    bucket?: string;
    endpoint?: string;
    objects?: S3Object[];
    totalObjects?: number;
    connected?: boolean;
    error?: string;
  };
}
