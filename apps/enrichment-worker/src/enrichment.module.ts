import { Module } from '@nestjs/common';
import { EnrichmentService } from './enrichment.service.js';
import { ENRICHMENT_RESOURCES, LANGUAGE_DETECTOR } from './enrichment.tokens.js';
import { createResources } from './enrichment.resources.js';
import { languageProcessor } from './processors/index.js';

@Module({
  providers: [
    EnrichmentService,
    {
      provide: ENRICHMENT_RESOURCES,
      useFactory: createResources,
    },
    {
      provide: LANGUAGE_DETECTOR,
      useValue: languageProcessor,
    },
  ],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
