import { Module } from '@nestjs/common';
import { CollectionQueriesController } from './queries.controller.js';
import { CollectionQueriesService } from './queries.service.js';

@Module({
  controllers: [CollectionQueriesController],
  providers: [CollectionQueriesService],
  exports: [CollectionQueriesService],
})
export class CollectionQueriesModule {}
