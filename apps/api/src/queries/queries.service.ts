import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ITEM_REPOSITORY, type ItemRepository } from '../tokens.js';
import { collectionQueryFilterSchema, queryIdSchema } from './queries.dto.js';
import { realityQuerySchema } from '../items/items.dto.js';
import { serialize } from '../common/serialize.js';

@Injectable()
export class CollectionQueriesService {
  constructor(@Inject(ITEM_REPOSITORY) private readonly repo: ItemRepository) {}

  async list(query: unknown): Promise<unknown> {
    const parsed = collectionQueryFilterSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const queries = await this.repo.listQueries(parsed.data);
    return serialize({ queries });
  }

  async get(id: string, query: unknown): Promise<unknown> {
    const parsed = realityQuerySchema.safeParse(query);
    if (!queryIdSchema.safeParse(id).success || !parsed.success) {
      throw new BadRequestException('Invalid query request');
    }
    const result = await this.repo.getQuery(id, parsed.data.realityId);
    if (!result) throw new NotFoundException('Collection query not found');
    return serialize(result);
  }
}
