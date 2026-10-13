import { customType, pgSchema } from 'drizzle-orm/pg-core';

export const core = pgSchema('core');
export const ingestSchema = pgSchema('ingest');
export const itemType = core.enum('item_type', ['post', 'reply', 'quote', 'repost', 'forward', 'comment', 'article', 'video', 'story']);
export const timeSource = core.enum('time_source', ['platform', 'feed', 'page_extracted', 'collected_at_fallback']);
export const geoKind = core.enum('geo_kind', ['geotag', 'content']);

// PostGIS accepts EWKT on writes and returns hex EWKB. Query coordinates through
// ST_X/ST_Y or the item_ds projection instead of assuming a JS geometry shape.
export const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Point, 4326)',
});
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});
