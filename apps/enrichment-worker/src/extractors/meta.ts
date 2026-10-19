import nlp from 'compromise';
import type { SilverObservation } from '@nexus/contracts';

type EntityType = 'PER' | 'ORG' | 'LOC';

export interface ExtractedEntity {
  type: EntityType;
  surface_form: string;
}

/**
 * Extract named entities from a silver observation's text.
 * Uses the `item.text` field of the observation.
 */
export function extractMetaFromSilver(silver: SilverObservation): ExtractedEntity[] {
  const item = silver?.event?.item;
  if (!item || typeof item.text !== 'string' || !item.text.trim()) {
    return [];
  }

  const text = item.text;
  const doc = nlp(text);

  const entities: ExtractedEntity[] = [
    ...doc.people().out('array').map((name: string) => ({
      type: 'PER' as const,
      surface_form: name,
    })),

    ...doc.organizations().out('array').map((name: string) => ({
      type: 'ORG' as const,
      surface_form: name,
    })),

    ...doc.places().out('array').map((name: string) => ({
      type: 'LOC' as const,
      surface_form: name,
    })),
  ];

  // Remove duplicates by type+surface_form
  return [...new Map(entities.map(e => [`${e.type}:${e.surface_form}`, e])).values()];
}

export default extractMetaFromSilver;
