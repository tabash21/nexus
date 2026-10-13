import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@nexus/contracts';
import { ITEM_REPOSITORY, type ItemRepository } from '../tokens.js';
import { itemIdSchema, itemQuerySchema, realityQuerySchema, type CursorPayload } from './items.dto.js';
import { decodeCursor, encodeCursor } from './items.cursor.js';
const serialize = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_, entry: unknown) => typeof entry === 'bigint' ? entry.toString() : entry));
@Injectable()
export class ItemsService {
  constructor(@Inject(ITEM_REPOSITORY) private readonly repo: ItemRepository) {}
  async list(query: unknown): Promise<unknown> {
    const parsed = itemQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const { cursor: encoded, ...options } = parsed.data;
    const { limit: _limit, ...filters } = options;
    const scope = hash(filters);
    let cursor: CursorPayload | undefined;
    if (encoded) {
      try { cursor = decodeCursor(encoded); if (cursor.scope !== scope) throw new Error('Cursor filters changed'); }
      catch { throw new BadRequestException('Invalid cursor'); }
    }
    const rows = await this.repo.list({ ...options, cursor });
    const items = rows.slice(0, options.limit);
    const last = items.at(-1);
    return serialize({ items, nextCursor: rows.length > options.limit && last ? encodeCursor(last, scope) : null });
  }
  async get(id: string, query: unknown): Promise<unknown> {
    const parsed = realityQuerySchema.safeParse(query);
    if (!itemIdSchema.safeParse(id).success || !parsed.success) throw new BadRequestException('Invalid item request');
    const item = await this.repo.get(id, parsed.data.realityId);
    if (!item) throw new NotFoundException('Item not found');
    return serialize(item);
  }
}
