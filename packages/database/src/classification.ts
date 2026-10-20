import type pg from 'pg';
import { sql } from 'drizzle-orm';
import { InvalidSentimentLabelError } from './errors.js';
import type { ClassificationRow } from './schema/index.js';
import type { IngestDatabase, IngestTransaction } from './types.js';

export { InvalidSentimentLabelError };

/**
 * Canonical sentiment labels defining the tone expressed in the content.
 *
 * - `positive`: Content expresses a predominantly favorable, supportive, optimistic,
 *   enthusiastic, or constructive tone.
 * - `neutral`: Content expresses an objective, matter-of-fact, factual, or balanced tone.
 * - `negative`: Content expresses a predominantly critical, adverse, hostile, pessimistic,
 *   or condemnatory tone.
 * - `mixed`: Content expresses both positive and negative tones simultaneously.
 */
export const SENTIMENT_LABELS = ['positive', 'neutral', 'negative', 'mixed'] as const;
export type SentimentLabel = (typeof SENTIMENT_LABELS)[number];

export function isSentimentLabel(value: unknown): value is SentimentLabel {
  return typeof value === 'string' && SENTIMENT_LABELS.includes(value as SentimentLabel);
}

export function validateSentimentLabel(value: unknown): SentimentLabel {
  if (!isSentimentLabel(value)) {
    throw new InvalidSentimentLabelError(
      `Invalid sentiment label: "${String(value)}". Allowed labels: ${SENTIMENT_LABELS.join(', ')}`,
    );
  }

  return value;
}

const UPSERT_CLASSIFICATION_SQL = `
  INSERT INTO core.classification (
    item_id,
    model,
    prompt_version,
    sentiment,
    relevance,
    misinfo_score,
    summary_en,
    classified_at,
    content_revision
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (item_id) DO UPDATE SET
    model = EXCLUDED.model,
    prompt_version = EXCLUDED.prompt_version,
    classified_at = EXCLUDED.classified_at,
    content_revision = EXCLUDED.content_revision,
    sentiment = COALESCE(EXCLUDED.sentiment, core.classification.sentiment),
    relevance = COALESCE(EXCLUDED.relevance, core.classification.relevance),
    misinfo_score = COALESCE(EXCLUDED.misinfo_score, core.classification.misinfo_score),
    summary_en = COALESCE(EXCLUDED.summary_en, core.classification.summary_en)
  RETURNING
    item_id,
    model,
    prompt_version,
    relevance,
    misinfo_score,
    sentiment,
    summary_en,
    classified_at,
    content_revision
`;

function isRawPg(target: unknown): target is pg.Pool | pg.PoolClient {
  return typeof target === 'object' && target !== null && 'query' in target && !('select' in target);
}

export interface SaveClassificationInput {
  itemId: string;
  model: string;
  promptVersion: string;
  contentRevision: bigint | number | string;
  sentiment?: SentimentLabel | string | null;
  relevance?: number | null;
  misinfoScore?: number | null;
  summaryEn?: string | null;
  classifiedAt?: string | Date;
}

/**
 * Persists a classification record into core.classification.
 *
 * Validates the sentiment label and preserves existing classification fields
 * when the corresponding values are not provided.
 */
export async function saveClassification(
  dbOrClient: IngestDatabase | IngestTransaction | pg.Pool | pg.PoolClient,
  input: SaveClassificationInput,
): Promise<ClassificationRow> {
  if (!input.itemId || typeof input.itemId !== 'string') {
    throw new Error('itemId is required');
  }

  if (!input.model || typeof input.model !== 'string') {
    throw new Error('model is required for classification provenance');
  }

  if (!input.promptVersion || typeof input.promptVersion !== 'string') {
    throw new Error('promptVersion is required for classification provenance');
  }

  const revision = BigInt(input.contentRevision);

  if (revision <= 0n) {
    throw new Error('contentRevision must be positive');
  }

  const validatedSentiment =
    input.sentiment == null ? null : validateSentimentLabel(input.sentiment);

  const relevance = input.relevance ?? null;

  if (relevance !== null && (relevance < 0 || relevance > 1)) {
    throw new Error('relevance must be between 0 and 1');
  }

  const misinfoScore = input.misinfoScore ?? null;

  if (misinfoScore !== null && (misinfoScore < 0 || misinfoScore > 1)) {
    throw new Error('misinfoScore must be between 0 and 1');
  }

  const summaryEn = input.summaryEn ?? null;
  const classifiedAt =
    input.classifiedAt instanceof Date
      ? input.classifiedAt.toISOString()
      : input.classifiedAt || new Date().toISOString();

  if (isRawPg(dbOrClient)) {
    const result = await dbOrClient.query(UPSERT_CLASSIFICATION_SQL, [
      input.itemId,
      input.model,
      input.promptVersion,
      validatedSentiment,
      relevance,
      misinfoScore,
      summaryEn,
      classifiedAt,
      revision.toString(),
    ]);

    const row = result.rows[0];

    if (!row) {
      throw new Error('Failed to upsert classification record');
    }

    return {
      ...row,
      content_revision: BigInt(row.content_revision),
    } as ClassificationRow;
  }

  const result = await dbOrClient.execute(sql`
    INSERT INTO core.classification (
      item_id,
      model,
      prompt_version,
      sentiment,
      relevance,
      misinfo_score,
      summary_en,
      classified_at,
      content_revision
    ) VALUES (
      ${input.itemId},
      ${input.model},
      ${input.promptVersion},
      ${validatedSentiment},
      ${relevance},
      ${misinfoScore},
      ${summaryEn},
      ${classifiedAt}::timestamptz,
      ${revision}
    )
    ON CONFLICT (item_id) DO UPDATE SET
      model = EXCLUDED.model,
      prompt_version = EXCLUDED.prompt_version,
      classified_at = EXCLUDED.classified_at,
      content_revision = EXCLUDED.content_revision,
      sentiment = COALESCE(EXCLUDED.sentiment, core.classification.sentiment),
      relevance = COALESCE(EXCLUDED.relevance, core.classification.relevance),
      misinfo_score = COALESCE(EXCLUDED.misinfo_score, core.classification.misinfo_score),
      summary_en = COALESCE(EXCLUDED.summary_en, core.classification.summary_en)
    RETURNING
      item_id,
      model,
      prompt_version,
      relevance,
      misinfo_score,
      sentiment,
      summary_en,
      classified_at,
      content_revision
  `);

  const rawRow = (result as { rows?: Array<Record<string, unknown>> }).rows?.[0];

  if (!rawRow) {
    throw new Error('Failed to upsert classification record');
  }

  return {
    item_id: String(rawRow.item_id),
    model: String(rawRow.model),
    prompt_version: String(rawRow.prompt_version),
    relevance:
      rawRow.relevance != null ? Number(rawRow.relevance) : null,
    misinfo_score:
      rawRow.misinfo_score != null ? Number(rawRow.misinfo_score) : null,
    sentiment:
      rawRow.sentiment != null ? String(rawRow.sentiment) : null,
    summary_en:
      rawRow.summary_en != null ? String(rawRow.summary_en) : null,
    classified_at: String(rawRow.classified_at),
    content_revision: BigInt(String(rawRow.content_revision)),
  };
}