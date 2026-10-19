import nlp from 'compromise';
import { createHash } from 'crypto';
import type { EnrichmentProcessor, EnrichmentTaskContext, ProcessorResult } from '../types.js';
import type { SilverObservation } from '@nexus/contracts';

export type EntityType = 'PER' | 'ORG' | 'LOC';

export interface ExtractedEntity {
  type: EntityType;
  surface_form: string;
}

export function generateEntityId(type: string, surface_form: string): string {
  const h = createHash('sha256');
  h.update(`${type}:${surface_form}`);
  return h.digest('hex');
}

export function extractMetaFromSilver(silver: SilverObservation): ExtractedEntity[] {
  const item = silver?.event?.item;
  if (!item || typeof item.text !== 'string' || !item.text.trim()) {
    return [];
  }

  const text = item.text;
  const doc = nlp(text);

  const entities: ExtractedEntity[] = [
    ...doc
      .people()
      .out('array')
      .map((name: string) => ({
        type: 'PER' as const,
        surface_form: name,
      })),
    ...doc
      .organizations()
      .out('array')
      .map((name: string) => ({
        type: 'ORG' as const,
        surface_form: name,
      })),
    ...doc
      .places()
      .out('array')
      .map((name: string) => ({
        type: 'LOC' as const,
        surface_form: name,
      })),
  ];

  return [...new Map(entities.map(entity => [`${entity.type}:${entity.surface_form}`, entity])).values()];
}

export function extractEntityMentionsFromText(text: string): ExtractedEntity[] {
  if (!text || !text.trim()) {
    return [];
  }

  return extractMetaFromSilver({
    event: {
      item: {
        text,
      },
    },
  } as SilverObservation);
}

export const entityMentionsProcessor: EnrichmentProcessor = {
  jobType: 'entity-mentions',
  version: 'entity-mentions.v1',
  inputs: ['text', 'title'],
  metadata: {
    jobType: 'entity-mentions',
    version: 'entity-mentions.v1',
    name: 'Entity Mentions',
    description: 'Extracts PER, ORG, and LOC mentions from item text.',
    target: 'text',
  },
  async process(context: EnrichmentTaskContext): Promise<ProcessorResult> {
    const text = [context.item.title, context.item.text].filter((part): part is string => Boolean(part)).join('\n');

    return {
      values: {
        entities: extractMetaFromSilver({
          event: {
            item: {
              text,
              title: context.item.title ?? null,
            },
          },
        } as SilverObservation),
      },
    };
  },
};
