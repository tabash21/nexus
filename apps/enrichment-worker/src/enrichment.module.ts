import { Module } from '@nestjs/common';
import { EnrichmentService } from './enrichment.service.js';
import { ENRICHMENT_RESOURCES } from './enrichment.tokens.js';
import { createResources } from './enrichment.resources.js';

@Module({
  providers: [
    EnrichmentService,
    {
      provide: ENRICHMENT_RESOURCES,
      useFactory: createResources,
    },
  ],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
