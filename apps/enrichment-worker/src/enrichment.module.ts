import { Module } from '@nestjs/common';
import { EnrichmentService } from './enrichment.service.js';
import { createResources, ENRICHMENT_RESOURCES } from './resources.js';

@Module({ providers: [EnrichmentService, { provide: ENRICHMENT_RESOURCES, useFactory: createResources }] })
export class EnrichmentModule {}
