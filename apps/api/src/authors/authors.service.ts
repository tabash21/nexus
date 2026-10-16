import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@nexus/contracts';
import { ITEM_REPOSITORY, type ItemRepository } from '../tokens.js';
import { authorIdSchema, authorQuerySchema, authorItemsQuerySchema } from './authors.dto.js';
import { realityQuerySchema, type CursorPayload } from '../items/items.dto.js';
import { decodeCursor, encodeCursor } from '../items/items.cursor.js';
import { serialize } from '../common/serialize.js';

@Injectable()
export class AuthorsService {
  constructor(@Inject(ITEM_REPOSITORY) private readonly repo: ItemRepository) {}

  async list(query: unknown): Promise<unknown> {
    const parsed = authorQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const rows = await this.repo.listAuthors(parsed.data);
    const authors = rows.slice(0, parsed.data.limit);
    const last = authors.at(-1);
    const nextCursor = rows.length > parsed.data.limit && last ? last.author_id : null;
    return serialize({ authors, nextCursor });
  }

  async get(id: string, query: unknown): Promise<unknown> {
    const parsed = realityQuerySchema.safeParse(query);
    if (!authorIdSchema.safeParse(id).success || !parsed.success) {
      throw new BadRequestException('Invalid author request');
    }
    const author = await this.repo.getAuthor(id, parsed.data.realityId);
    if (!author) throw new NotFoundException('Author not found');
    return serialize(author);
  }

  async getItems(id: string, query: unknown): Promise<unknown> {
    if (!authorIdSchema.safeParse(id).success) throw new BadRequestException('Invalid author id');
    const parsed = authorItemsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');
    const { cursor: encoded, ...options } = parsed.data;
    const { limit: _limit, ...filters } = options;
    const scope = hash({ ...filters, author: id });
    let cursor: CursorPayload | undefined;
    if (encoded) {
      try {
        cursor = decodeCursor(encoded);
        if (cursor.scope !== scope) throw new Error('Cursor filters changed');
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }
    const rows = await this.repo.getAuthorItems(id, { ...options, cursor });
    const items = rows.slice(0, options.limit);
    const last = items.at(-1);
    return serialize({
      items,
      nextCursor: rows.length > options.limit && last ? encodeCursor(last, scope) : null,
    });
  }
}
