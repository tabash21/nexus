import { TOPIC_CATALOG, validateTopicCatalog } from '@nexus/contracts';
import { topic } from './schema/index.js';
import type { IngestDatabase } from './types.js';

export async function syncClassifierTopics(db: IngestDatabase): Promise<void> {
  validateTopicCatalog(TOPIC_CATALOG);
  const rows = TOPIC_CATALOG.map(entry => ({
    topic_id: entry.topic_id,
    name: entry.name,
    description: entry.description,
    active: true,
  }));

  for (const row of rows) {
    await db
      .insert(topic)
      .values(row)
      .onConflictDoUpdate({
        target: topic.topic_id,
        set: {
          name: row.name,
          description: row.description,
          active: true,
        },
      });
  }
}
