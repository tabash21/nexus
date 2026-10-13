import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@nexus/contracts';
import { ITEM_REPOSITORY, type ItemRepository } from '../tokens.js';
import { topicIdSchema, topicQuerySchema, topicItemsQuerySchema } from './topics.dto.js';
import { type CursorPayload } from '../items/items.dto.js';
import { decodeCursor, encodeCursor } from '../items/items.cursor.js';
import { serialize } from '../common/serialize.js';

@Injectable()
export class TopicsService {
  constructor(@Inject(ITEM_REPOSITORY) private readonly repo: ItemRepository) {}

  async list(query: unknown): Promise<unknown> {
    const parsed = topicQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const topics = await this.repo.listTopics(parsed.data);
    return serialize({ topics });
  }

  async get(id: string): Promise<unknown> {
    if (!topicIdSchema.safeParse(id).success) throw new BadRequestException('Invalid topic id');
    const topic = await this.repo.getTopic(id);
    if (!topic) throw new NotFoundException('Topic not found');
    return serialize(topic);
  }

  async getItems(id: string, query: unknown): Promise<unknown> {
    if (!topicIdSchema.safeParse(id).success) throw new BadRequestException('Invalid topic id');
    const parsed = topicItemsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const { cursor: encoded, ...options } = parsed.data;
    const { limit: _limit, ...filters } = options;
    const scope = hash({ ...filters, topic: id });
    let cursor: CursorPayload | undefined;
    if (encoded) {
      try {
        cursor = decodeCursor(encoded);
        if (cursor.scope !== scope) throw new Error('Cursor filters changed');
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }
    const rows = await this.repo.getTopicItems(id, { ...options, cursor });
    const items = rows.slice(0, options.limit);
    const last = items.at(-1);
    return serialize({
      items,
      nextCursor: rows.length > options.limit && last ? encodeCursor(last, scope) : null,
    });
  }
}
