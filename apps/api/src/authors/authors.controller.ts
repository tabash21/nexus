import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../common/auth.guard.js';
import { AuthorsService } from './authors.service.js';

@Controller('v1/authors')
@UseGuards(BearerGuard)
export class AuthorsController {
  constructor(@Inject(AuthorsService) private readonly authors: AuthorsService) {}

  @Get()
  list(@Query() query: unknown): Promise<unknown> {
    return this.authors.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.authors.get(id, query);
  }

  @Get(':id/items')
  getItems(@Param('id') id: string, @Query() query: unknown): Promise<unknown> {
    return this.authors.getItems(id, query);
  }
}
