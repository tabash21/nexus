import { Module } from '@nestjs/common';
import { EnrichmentService } from './enrichment.service.js';
import { ENRICHMENT_RESOURCES } from './enrichment.tokens.js';
import { createResources } from './enrichment.resources.js';
import { MediaProcessingService } from './media/media.service.js';

@Module({
  providers: [
    EnrichmentService,
    MediaProcessingService,
    {
      provide: ENRICHMENT_RESOURCES,
      useFactory: createResources,
    },
  ],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
