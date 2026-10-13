import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { ITEM_REPOSITORY, type ItemRepository } from '../tokens.js';
import { serialize } from '../common/serialize.js';

const platformCodeSchema = z.string().min(1).max(50);

@Injectable()
export class PlatformsService {
  constructor(@Inject(ITEM_REPOSITORY) private readonly repo: ItemRepository) {}

  async list(): Promise<unknown> {
    const platforms = await this.repo.listPlatforms();
    return serialize({ platforms });
  }

  async get(platformCode: string): Promise<unknown> {
    if (!platformCodeSchema.safeParse(platformCode).success) {
      throw new BadRequestException('Invalid platform code');
    }
    const platform = await this.repo.getPlatform(platformCode);
    if (!platform) throw new NotFoundException('Platform not found');
    return serialize(platform);
  }
}
