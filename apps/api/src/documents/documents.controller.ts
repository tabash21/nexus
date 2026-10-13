import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { BearerGuard } from '../common/auth.guard.js';
import { DocumentsService } from './documents.service.js';

@Controller('v1/documents')
@UseGuards(BearerGuard)
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.documents.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.documents.get(id);
  }
}
