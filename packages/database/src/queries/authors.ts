import { and, eq, gt, type SQL } from 'drizzle-orm';
import type { IngestDatabase } from '../types.js';
import { author } from '../schema/index.js';
import type { AuthorRow } from '../schema/index.js';
import type { AuthorListOptions, ListOptions, ItemListEntry, FullItemRow } from './types.js';
import { listItems } from './items.js';

export async function listAuthors(db: IngestDatabase, options: AuthorListOptions): Promise<AuthorRow[]> {
  const conditions: SQL[] = [eq(author.reality_id, options.realityId)];
  if (options.platform) conditions.push(eq(author.platform, options.platform));
  if (options.verified !== undefined) conditions.push(eq(author.verified, options.verified));
  if (options.isAutomated !== undefined) conditions.push(eq(author.is_automated, options.isAutomated));
  if (options.cursor) conditions.push(gt(author.author_id, options.cursor));

  return db
    .select()
    .from(author)
    .where(and(...conditions))
    .orderBy(author.author_id)
    .limit(options.limit + 1);
}

export async function getAuthor(db: IngestDatabase, id: string, realityId: number): Promise<AuthorRow | null> {
  const [row] = await db
    .select()
    .from(author)
    .where(and(eq(author.author_id, id), eq(author.reality_id, realityId)))
    .limit(1);
  return row ?? null;
}

export async function getAuthorItems(
  db: IngestDatabase,
  authorId: string,
  options: ListOptions,
): Promise<(ItemListEntry | FullItemRow)[]> {
  return listItems(db, { ...options, author: authorId });
}
