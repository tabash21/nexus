CREATE VIEW core.item_ds AS
SELECT
  i.*,
  char_length(i.content_text) AS content_length,
  COALESCE((SELECT array_agg(domain ORDER BY domain) FROM (
    SELECT DISTINCT lower(substring(link FROM '^[a-zA-Z]+://([^/:?#]+)')) AS domain
    FROM unnest(i.links) AS link
  ) domains WHERE domain IS NOT NULL), '{}'::text[]) AS link_domains,
  EXISTS (SELECT 1 FROM core.item_media m WHERE m.item_id = i.item_id) AS has_media,
  e.views, e.likes, e.likes_kind, e.reposts, e.replies, e.quotes, e.saves, e.reactions,
  e.captured_at AS engagement_seen_at, e.provider AS engagement_provider,
  s.arena, s.source_kind, s.display_name AS source_name, s.subscribers AS source_subscribers,
  COALESCE(loc.geo_kind, CASE WHEN s.home_country IS NOT NULL THEN 'source_default' END) AS geo_kind,
  loc.place_name AS geo_place_name,
  CASE WHEN loc.place_id IS NOT NULL THEN loc.country ELSE s.home_country END AS geo_country,
  loc.lat, loc.lon,
  (SELECT count(*) FROM core.item d WHERE d.reality_id = i.reality_id AND d.dup_of = i.item_id) AS dup_count,
  i.deleted_at IS NOT NULL AS is_deleted,
  COALESCE(a.handle, i.author_name_raw) AS author,
  a.followers AS author_followers, a.verified AS author_verified,
  a.account_created_at AS author_created_at, a.bot_score,
  c.relevance, c.misinfo_score, c.sentiment, c.summary_en,
  COALESCE((SELECT array_agg(t.topic_id ORDER BY t.score DESC, t.topic_id)
    FROM core.item_topic t WHERE t.item_id = i.item_id AND t.content_revision = i.content_revision), '{}'::text[]) AS topics
FROM core.item i
JOIN core.source s ON s.reality_id = i.reality_id AND s.source_id = i.source_id
LEFT JOIN core.author a ON a.reality_id = i.reality_id AND a.author_id = i.author_id
LEFT JOIN core.classification c ON c.item_id = i.item_id AND c.content_revision = i.content_revision
LEFT JOIN LATERAL (
  SELECT * FROM core.engagement_snapshot es WHERE es.item_id = i.item_id
  ORDER BY es.captured_at DESC, es.provider ASC LIMIT 1
) e ON true
LEFT JOIN LATERAL (
  SELECT x.place_id, x.kind AS geo_kind, p.canonical_name AS place_name, p.country,
    ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lon
  FROM (
    SELECT l.place_id, l.geo_kind::text AS kind,
      CASE l.geo_kind WHEN 'geotag' THEN 1 ELSE 2 END AS rank, l.confidence
    FROM core.item_location l
    WHERE l.item_id = i.item_id AND l.reality_id = i.reality_id AND l.content_revision = i.content_revision
    UNION ALL
    SELECT a.profile_place_id, 'author_profile', 3, NULL WHERE a.profile_place_id IS NOT NULL
  ) x JOIN core.entity p ON p.reality_id = i.reality_id AND p.entity_id = x.place_id
  ORDER BY x.rank, x.confidence DESC NULLS LAST, x.place_id LIMIT 1
) loc ON true;

COMMENT ON VIEW core.item_ds IS 'Current item projection across realities; callers must filter reality_id, defaulting to 0.';
