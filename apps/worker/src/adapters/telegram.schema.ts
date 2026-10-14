import { z } from 'zod';

export const telegramPeerIdSchema = z.object({
  channelId: z.union([z.string(), z.number()]).optional(),
  chatId: z.union([z.string(), z.number()]).optional(),
  userId: z.union([z.string(), z.number()]).optional(),
  className: z.string().optional(),
}).passthrough();

export const telegramEntitySchema = z.object({
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  className: z.string().optional(),
  url: z.string().optional(),
}).passthrough();

export const telegramRepliesSchema = z.object({
  replies: z.number().int().optional(),
  comments: z.boolean().optional(),
}).passthrough();

export const telegramMessageSchema = z.object({
  id: z.union([z.number().int(), z.string().regex(/^\d+$/)]),
  peerId: telegramPeerIdSchema,
  date: z.number().int(),
  message: z.string().default(''),
  className: z.string().optional(),
  flags: z.number().int().optional(),
  out: z.boolean().optional(),
  mentioned: z.boolean().optional(),
  mediaUnread: z.boolean().optional(),
  silent: z.boolean().optional(),
  post: z.boolean().optional(),
  fromScheduled: z.boolean().optional(),
  legacy: z.boolean().optional(),
  editHide: z.boolean().optional(),
  pinned: z.boolean().optional(),
  noforwards: z.boolean().optional(),
  invertMedia: z.boolean().optional(),
  flags2: z.number().int().optional(),
  offline: z.boolean().optional(),
  videoProcessingPending: z.boolean().optional(),
  fromId: telegramPeerIdSchema.nullable().optional(),
  fromBoostsApplied: z.unknown().nullable().optional(),
  savedPeerId: z.unknown().nullable().optional(),
  fwdFrom: z.unknown().nullable().optional(),
  viaBotId: z.unknown().nullable().optional(),
  viaBusinessBotId: z.unknown().nullable().optional(),
  replyTo: z.unknown().nullable().optional(),
  media: z.unknown().nullable().optional(),
  replyMarkup: z.unknown().nullable().optional(),
  entities: z.array(telegramEntitySchema).nullable().optional(),
  views: z.number().int().nullable().optional(),
  forwards: z.number().int().nullable().optional(),
  replies: telegramRepliesSchema.nullable().optional(),
  editDate: z.number().int().nullable().optional(),
  postAuthor: z.string().nullable().optional(),
  groupedId: z.union([z.string(), z.number()]).nullable().optional(),
  reactions: z.unknown().nullable().optional(),
  restrictionReason: z.unknown().nullable().optional(),
  ttlPeriod: z.number().int().nullable().optional(),
  quickReplyShortcutId: z.unknown().nullable().optional(),
  effect: z.unknown().nullable().optional(),
  factcheck: z.unknown().nullable().optional(),
  reportDeliveryUntilDate: z.unknown().nullable().optional(),
}).passthrough();

export type TelegramMessage = z.infer<typeof telegramMessageSchema>;
export type TelegramPeerId = z.infer<typeof telegramPeerIdSchema>;
export type TelegramEntity = z.infer<typeof telegramEntitySchema>;
