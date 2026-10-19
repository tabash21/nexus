import { z } from 'zod';
import { PLATFORM_PATTERN } from './patterns.js';
import { timestamp } from './schema.js';

const nullableText = z.string().nullable();

/** Current `core.item` state after the silver writer's PostgreSQL commit. */
export const goldItemSchema = z
  .object({
    itemId: z.string().min(1),
    realityId: z.number().int().nonnegative(),
    platform: z.string().regex(PLATFORM_PATTERN),
    nativeId: z.string().min(1),
    itemType: z.enum(['post', 'reply', 'quote', 'repost', 'forward', 'comment', 'article', 'video', 'story']),
    schemaVersion: z.string().min(1),
    url: nullableText,
    sourceId: z.string().min(1),
    authorId: nullableText,
    authorNameRaw: nullableText,
    publishedAt: timestamp,
    publishedAtSource: z.enum(['platform', 'feed', 'page_extracted', 'collected_at_fallback']),
    editedAt: timestamp.nullable(),
    collectedAt: timestamp,
    lastSeenAt: timestamp,
    deletedAt: timestamp.nullable(),
    title: nullableText,
    text: z.string(),
    lang: nullableText,
    langConfidence: z.number().min(0).max(1).nullable(),
    langPlatform: nullableText,
    hashtags: z.array(z.string()),
    mentions: z.array(z.string()),
    links: z.array(z.string()),
    isSensitive: z.boolean().nullable(),
    replyToItemId: nullableText,
    conversationId: nullableText,
    quotedItemId: nullableText,
    sharedFromItemId: nullableText,
    sharedFromSource: nullableText,
    duplicateOf: nullableText,
    contentHash: z.string().min(1),
    /** Increases on every title or text change; consumers keep the highest revision per item. */
    contentRevision: z.string().regex(/^\d+$/),
    currentEventId: z.string().uuid(),
    collector: z.string().min(1),
    provider: z.string().min(1),
    rawUri: nullableText,
    platformExtra: z.record(z.unknown()),
  })
  .strict();

/**
 * Versioned writer-to-consumer envelope on the gold topic, keyed by `item.itemId`.
 * Delivery is at-least-once: every processed silver observation, including redeliveries,
 * republishes the current item, so consumers deduplicate by `itemId` + `contentRevision`.
 */
export const goldItemMessageSchema = z
  .object({
    stageVersion: z.literal('gold.v1'),
    /** Silver event whose processing produced this message. */
    eventId: z.string().uuid(),
    item: goldItemSchema,
  })
  .strict();

export type GoldItem = z.infer<typeof goldItemSchema>;
export type GoldItemMessage = z.infer<typeof goldItemMessageSchema>;
