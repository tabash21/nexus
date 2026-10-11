import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DOCUMENT_REPOSITORY, type DocumentRepository } from './tokens.js';

const cursorSchema = z.object({ time: z.string().datetime({ offset: true }), id: z.string().uuid() });
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  source: z.string().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().max(1000).optional(),
}).strict().refine(v => !v.from || !v.to || new Date(v.from) < new Date(v.to), 'from must be earlier than to');

@Injectable()
export class DocumentsService {
  constructor(@Inject(DOCUMENT_REPOSITORY) private readonly repo: DocumentRepository) {}
  async list(query: unknown) {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const { cursor: encoded, ...options } = parsed.data;
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (encoded) {
      try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))); }
      catch { throw new BadRequestException('Invalid cursor'); }
    }
    const rows = await this.repo.list({ ...options, cursor });
    const items = rows.slice(0, options.limit);
    const last = items.at(-1);
    const nextCursor = rows.length > options.limit && last
      ? Buffer.from(JSON.stringify({ time: new Date(last.last_seen_at).toISOString(), id: last.id })).toString('base64url') : null;
    return { items, nextCursor };
  }
  async get(id: string) {
    if (!z.string().uuid().safeParse(id).success) throw new BadRequestException('Invalid document ID');
    const item = await this.repo.get(id);
    if (!item) throw new NotFoundException('Document not found');
    return item;
  }
}

