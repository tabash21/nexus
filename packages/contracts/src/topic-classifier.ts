import { TOPIC_CATALOG, TOPIC_IDS, type TopicCatalogEntry, type TopicConceptConfig, type TopicId } from './topic-catalog.js';

export { TOPIC_CATALOG, TOPIC_IDS } from './topic-catalog.js';
export type { TopicCatalogEntry, TopicConceptConfig, TopicId } from './topic-catalog.js';

export const TOPIC_CONCEPT_WEIGHTS = {
  high: 0.8,
  strong: 0.4,
  weak: 0.15,
} as const;

export type ConceptWeight = keyof typeof TOPIC_CONCEPT_WEIGHTS;

export interface TopicAssignment {
  topicId: TopicId;
  score: number;
  conceptIds: string[];
}

const normalizeDirectory = new Map<string, string>([['ا', 'ا'], ['أ', 'ا'], ['إ', 'ا'], ['آ', 'ا'], ['ٱ', 'ا'], ['ى', 'ي'], ['ة', 'ة'], ['ئ', 'ي'], ['ؤ', 'و'], ['ى', 'ي']]);

function normalizeClassifierText(value: string): string {
  if (!value) return '';
  let output = value.normalize('NFC').replace(/\r\n?/g, '\n');
  output = output.replace(/https?:\/\/[^\s]+/gi, ' ');
  output = output.replace(/www\.[^\s]+/gi, ' ');
  output = output.replace(/[\u0591-\u05C7]/g, '');
  output = output.replace(/[\u064B-\u065F\u0670]/g, '');
  output = output.replace(/[\u0640]/g, '');
  for (const [source, target] of normalizeDirectory) {
    output = output.replace(new RegExp(source, 'g'), target);
  }
  output = output.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return output.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldMatchesPattern(field: string, pattern: string): boolean {
  const normalizedField = normalizeClassifierText(field);
  const normalizedPattern = normalizeClassifierText(pattern);
  if (!normalizedField || !normalizedPattern) return false;
  const boundaryPattern = `(^|[^\\p{L}\\p{N}])${escapeRegex(normalizedPattern).replace(/\s+/g, '[\\s\\u00A0]+')}(?=$|[^\\p{L}\\p{N}])`;
  return new RegExp(boundaryPattern, 'giu').test(normalizedField);
}

function conceptMatches(fieldText: string | null | undefined, concept: TopicConceptConfig): boolean {
  if (!fieldText) return false;
  return concept.patterns.some(pattern => fieldMatchesPattern(fieldText, pattern));
}

export function classifyItemTopics(title?: string | null, body?: string | null): TopicAssignment[] {
  const titleText = typeof title === 'string' ? title : '';
  const bodyText = typeof body === 'string' ? body : '';
  if (!normalizeClassifierText(titleText) && !normalizeClassifierText(bodyText)) {
    return [{ topicId: 'other', score: 0, conceptIds: [] }];
  }

  const matches: TopicAssignment[] = [];

  for (const topic of TOPIC_CATALOG) {
    if (topic.topic_id === 'other') continue;

    const matchedConcepts = new Map<string, ConceptWeight>();
    for (const concept of topic.concepts) {
      if (conceptMatches(titleText, concept) || conceptMatches(bodyText, concept)) {
        matchedConcepts.set(concept.id, concept.weight);
      }
    }

    if (matchedConcepts.size === 0) continue;

    const weights = [...matchedConcepts.values()].map(weight => TOPIC_CONCEPT_WEIGHTS[weight]);
    const score = Number(Math.min(weights.reduce((sum, weight) => sum + weight, 0), 1).toFixed(4));
    const hasHigh = [...matchedConcepts.values()].some(weight => weight === 'high');
    const strongCount = [...matchedConcepts.values()].filter(weight => weight === 'strong').length;

    if (score >= 0.8 && (hasHigh || strongCount >= 2)) {
      matches.push({
        topicId: topic.topic_id,
        score,
        conceptIds: [...matchedConcepts.keys()],
      });
    }
  }

  const sorted = matches.sort((a, b) => a.topicId.localeCompare(b.topicId));
  if (sorted.length > 0) return sorted;
  return [{ topicId: 'other', score: 0, conceptIds: [] }];
}

export function validateTopicCatalog(catalog: readonly TopicCatalogEntry[]): void {
  if (!catalog.length) {
    throw new Error('Topic catalog is empty');
  }
  const topicIds = new Set<string>();
  for (const topic of catalog) {
    if (topic.topic_id === 'other' && topic.concepts.length > 0) {
      throw new Error('The other topic must not define keyword patterns');
    }
    if (topicIds.has(topic.topic_id)) {
      throw new Error(`Duplicate topic definition: ${topic.topic_id}`);
    }
    topicIds.add(topic.topic_id);
    for (const concept of topic.concepts) {
      if (!concept.id || !concept.patterns.length) {
        throw new Error(`Invalid concept definition for ${topic.topic_id}`);
      }
      for (const pattern of concept.patterns) {
        if (!normalizeClassifierText(pattern)) {
          throw new Error(`Empty pattern in ${topic.topic_id}/${concept.id}`);
        }
      }
    }
  }
  if (!Object.values(TOPIC_IDS).includes('other')) {
    throw new Error('The other fallback topic must be present');
  }
}

validateTopicCatalog(TOPIC_CATALOG);
