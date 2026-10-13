import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ITEM_REPOSITORY, type ItemRepository } from '../tokens.js';
import { realityQuerySchema } from '../items/items.dto.js';
import { serialize } from '../common/serialize.js';

@Injectable()
export class StatsService {
  constructor(@Inject(ITEM_REPOSITORY) private readonly repo: ItemRepository) {}

  async getOverview(query: unknown): Promise<unknown> {
    const parsed = realityQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const stats = await this.repo.getStats(parsed.data.realityId);
    return serialize(stats);
  }
}
