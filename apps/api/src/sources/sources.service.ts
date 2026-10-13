import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@nexus/contracts';
import { ITEM_REPOSITORY, type ItemRepository } from '../tokens.js';
import { sourceIdSchema, sourceQuerySchema, sourceItemsQuerySchema } from './sources.dto.js';
import { realityQuerySchema, type CursorPayload } from '../items/items.dto.js';
import { decodeCursor, encodeCursor } from '../items/items.cursor.js';
import { serialize } from '../common/serialize.js';

@Injectable()
export class SourcesService {
  constructor(@Inject(ITEM_REPOSITORY) private readonly repo: ItemRepository) {}

  async list(query: unknown): Promise<unknown> {
    const parsed = sourceQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const rows = await this.repo.listSources(parsed.data);
    const sources = rows.slice(0, parsed.data.limit);
    const last = sources.at(-1);
    const nextCursor = rows.length > parsed.data.limit && last ? last.source_id : null;
    return serialize({ sources, nextCursor });
  }

  async get(id: string, query: unknown): Promise<unknown> {
    const parsed = realityQuerySchema.safeParse(query);
    if (!sourceIdSchema.safeParse(id).success || !parsed.success) {
      throw new BadRequestException('Invalid source request');
    }
    const source = await this.repo.getSource(id, parsed.data.realityId);
    if (!source) throw new NotFoundException('Source not found');
    return serialize(source);
  }

  async getItems(id: string, query: unknown): Promise<unknown> {
    if (!sourceIdSchema.safeParse(id).success) throw new BadRequestException('Invalid source id');
    const parsed = sourceItemsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const { cursor: encoded, ...options } = parsed.data;
    const { limit: _limit, ...filters } = options;
    const scope = hash({ ...filters, source: id });
    let cursor: CursorPayload | undefined;
    if (encoded) {
      try {
        cursor = decodeCursor(encoded);
        if (cursor.scope !== scope) throw new Error('Cursor filters changed');
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }
    const rows = await this.repo.getSourceItems(id, { ...options, cursor });
    const items = rows.slice(0, options.limit);
    const last = items.at(-1);
    return serialize({
      items,
      nextCursor: rows.length > options.limit && last ? encodeCursor(last, scope) : null,
    });
  }
}
