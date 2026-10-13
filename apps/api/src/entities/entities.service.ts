import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@nexus/contracts';
import { ITEM_REPOSITORY, type ItemRepository } from '../tokens.js';
import { entityIdSchema, entityQuerySchema, entityItemsQuerySchema } from './entities.dto.js';
import { realityQuerySchema, type CursorPayload } from '../items/items.dto.js';
import { decodeCursor, encodeCursor } from '../items/items.cursor.js';
import { serialize } from '../common/serialize.js';

@Injectable()
export class EntitiesService {
  constructor(@Inject(ITEM_REPOSITORY) private readonly repo: ItemRepository) {}

  async list(query: unknown): Promise<unknown> {
    const parsed = entityQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const rows = await this.repo.listEntities(parsed.data);
    const entities = rows.slice(0, parsed.data.limit);
    const last = entities.at(-1);
    const nextCursor = rows.length > parsed.data.limit && last ? last.entity_id : null;
    return serialize({ entities, nextCursor });
  }

  async get(id: string, query: unknown): Promise<unknown> {
    const parsed = realityQuerySchema.safeParse(query);
    if (!entityIdSchema.safeParse(id).success || !parsed.success) {
      throw new BadRequestException('Invalid entity request');
    }
    const entity = await this.repo.getEntity(id, parsed.data.realityId);
    if (!entity) throw new NotFoundException('Entity not found');
    return serialize(entity);
  }

  async getItems(id: string, query: unknown): Promise<unknown> {
    if (!entityIdSchema.safeParse(id).success) throw new BadRequestException('Invalid entity id');
    const parsed = entityItemsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const { cursor: encoded, ...options } = parsed.data;
    const { limit: _limit, ...filters } = options;
    const scope = hash({ ...filters, entityId: id });
    let cursor: CursorPayload | undefined;
    if (encoded) {
      try {
        cursor = decodeCursor(encoded);
        if (cursor.scope !== scope) throw new Error('Cursor filters changed');
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }
    const rows = await this.repo.getEntityItems(id, { ...options, cursor });
    const items = rows.slice(0, options.limit);
    const last = items.at(-1);
    return serialize({
      items,
      nextCursor: rows.length > options.limit && last ? encodeCursor(last, scope) : null,
    });
  }
}
