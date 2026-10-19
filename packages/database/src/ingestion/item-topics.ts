import { eq } from 'drizzle-orm';
import { classifyItemTopics, validateTopicCatalog, TOPIC_CATALOG } from '@nexus/contracts';
import { itemTopic } from '../schema/index.js';
import type { IngestTransaction } from '../types.js';

export async function saveItemTopics(
  tx: IngestTransaction,
  itemId: string,
  contentRevision: bigint,
  title: string | null,
  contentText: string | null,
): Promise<void> {
  validateTopicCatalog(TOPIC_CATALOG);
  const assignments = classifyItemTopics(title, contentText);
  await tx.delete(itemTopic).where(eq(itemTopic.item_id, itemId));

  await tx.insert(itemTopic).values(
    assignments.map(assignment => ({
      item_id: itemId,
      topic_id: assignment.topicId,
      score: Number(assignment.score.toFixed(4)),
      content_revision: contentRevision,
    })),
  );
}
