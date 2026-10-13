import type {
  ItemRow,
  ItemMediaRow,
  ItemTopicRow,
  ItemLocationRow,
  ItemEntityRow,
  ItemQueryMatchRow,
  ClassificationRow,
  EngagementSnapshotRow,
  SourceRow,
  AuthorRow,
  RealityRow,
  PlatformRow,
  TopicRow,
  EntityRow,
  CollectionQueryRow,
  EmbeddingRow,
} from '../schema/index.js';

export interface ListOptions {
  limit: number;
  realityId: number;
  source?: string;
  platform?: string;
  author?: string;
  topic?: string;
  entityId?: string;
  lang?: string;
  itemType?: string;
  from?: string;
  to?: string;
  cursor?: { time: string; id: string };
  full?: boolean;
}

export type ItemListEntry = {
  item_id: string;
  reality_id: number;
  platform: string;
  native_id: string;
  source_id: string;
  published_at: string;
  last_seen_at: string;
  title: string | null;
  url: string | null;
  lang: string | null;
  content_revision: bigint;
};

export type FullItemRow = Omit<ItemRow, 'tsv'>;

export type EnrichedTopic = ItemTopicRow & {
  name: string | null;
  description: string | null;
};

export type EnrichedLocation = ItemLocationRow & {
  canonical_name: string | null;
  country: string | null;
  admin1: string | null;
  geonames_id: bigint | null;
};

export type EnrichedEntity = ItemEntityRow & {
  canonical_name: string | null;
  type: string | null;
  country: string | null;
};

export type EnrichedQueryMatch = ItemQueryMatchRow & {
  query_text: string | null;
  description: string | null;
};

export type ItemEmbeddingInfo = Omit<EmbeddingRow, 'content_vec' | 'title_vec'> & {
  has_content_vec?: boolean;
  has_title_vec?: boolean;
};

export interface ItemRelations {
  duplicateOf: ItemListEntry | null;
  replyTo: ItemListEntry | null;
  quoted: ItemListEntry | null;
  sharedFrom: ItemListEntry | null;
  replies: ItemListEntry[];
  duplicates: ItemListEntry[];
}

export type ItemDetail = FullItemRow & {
  media: ItemMediaRow[];
  topics: EnrichedTopic[];
  locations: EnrichedLocation[];
  entities: EnrichedEntity[];
  queries: EnrichedQueryMatch[];
  classification: ClassificationRow | null;
  engagement: EngagementSnapshotRow | null;
  author: AuthorRow | null;
  source: SourceRow | null;
  reality: RealityRow | null;
  platformInfo: PlatformRow | null;
  embeddings: ItemEmbeddingInfo[];
  relations: ItemRelations;
};

export interface SourceListOptions {
  realityId: number;
  platform?: string;
  arena?: string;
  tier?: string;
  active?: boolean;
  limit: number;
  cursor?: string;
}

export interface AuthorListOptions {
  realityId: number;
  platform?: string;
  verified?: boolean;
  isAutomated?: boolean;
  limit: number;
  cursor?: string;
}

export interface EntityListOptions {
  realityId: number;
  type?: string;
  country?: string;
  search?: string;
  limit: number;
  cursor?: string;
}

export interface QueryListOptions {
  realityId: number;
  platform?: string;
  active?: boolean;
  limit: number;
}

export interface PlatformStat {
  platform: string;
  count: number;
}

export interface StatsResult {
  realityId: number;
  itemsCount: number;
  sourcesCount: number;
  authorsCount: number;
  platforms: PlatformStat[];
}
