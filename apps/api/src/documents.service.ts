import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DOCUMENT_REPOSITORY, type DocumentRepository } from './tokens.js';
import { documentIdSchema, documentQuerySchema, type CursorPayload } from './documents.dto.js';
import { decodeCursor, encodeCursor } from './documents.cursor.js';

@Injectable()
export class DocumentsService {
  constructor(@Inject(DOCUMENT_REPOSITORY) private readonly repo: DocumentRepository) {}

  async list(query: unknown) {
    const parsed = documentQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query parameters');

    const { cursor: encoded, ...options } = parsed.data;
    let cursor: CursorPayload | undefined;
    if (encoded) {
      try {
        cursor = decodeCursor(encoded);
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const rows = await this.repo.list({ ...options, cursor });
    const items = rows.slice(0, options.limit);
    const last = items.at(-1);
    const nextCursor = rows.length > options.limit && last ? encodeCursor(last) : null;

    return { items, nextCursor };
  }

  async get(id: string) {
    if (!documentIdSchema.safeParse(id).success) {
      throw new BadRequestException('Invalid document ID');
    }
    const item = await this.repo.get(id);
    if (!item) {
      throw new NotFoundException('Document not found');
    }
    return item;
  }
}
