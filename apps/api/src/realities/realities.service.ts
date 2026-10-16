import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { ITEM_REPOSITORY, type ItemRepository } from '../tokens.js';
import { serialize } from '../common/serialize.js';

const realityIdSchema = z.coerce.number().int().min(0).max(2147483647);

@Injectable()
export class RealitiesService {
  constructor(@Inject(ITEM_REPOSITORY) private readonly repo: ItemRepository) {}

  async list(): Promise<unknown> {
    const realities = await this.repo.listRealities();
    return serialize({ realities });
  }

  async get(id: string): Promise<unknown> {
    const parsed = realityIdSchema.safeParse(id);
    if (!parsed.success) throw new BadRequestException('Invalid reality id');
    const reality = await this.repo.getReality(parsed.data);
    if (!reality) throw new NotFoundException('Reality not found');
    return serialize(reality);
  }
}
