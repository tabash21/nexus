import { describe, expect, it } from 'vitest';
import { classifyItemTopics, TOPIC_CATALOG } from '@nexus/contracts';
import { syncClassifierTopics } from '@nexus/database';
import { createItemTestDatabase } from './helpers/item-database.js';

describe('multilingual topic assignment', () => {
  it('classifies equivalent English, Hebrew, and Arabic security language deterministically', () => {
    const english = classifyItemTopics('Airstrike hits military base', 'The army launched a missile attack on the convoy.');
    const hebrew = classifyItemTopics('הפצצה פגעה בבסיס צבאי', 'הצבא שיגר טיל לעבר האזור');
    const arabic = classifyItemTopics('ضربة جوية على قاعدة عسكرية', 'القوات أطلقت صاروخا على المنطقة');

    for (const result of [english, hebrew, arabic]) {
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ topicId: 'security_defense', score: expect.any(Number) }),
        ]),
      );
      expect(result.find(row => row.topicId === 'security_defense')?.score).toBeGreaterThanOrEqual(0.8);
      expect(result.every(row => row.score >= 0 && row.score <= 1)).toBe(true);
    }
  });

  it('classifies a standard single-topic item as a substantive topic', () => {
    const result = classifyItemTopics('Municipal election results announced', 'The government ministry confirmed the election outcome and cabinet appointment.');

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topicId: 'politics_governance', score: expect.any(Number) }),
      ]),
    );
    expect(result.find(row => row.topicId === 'politics_governance')?.score).toBeGreaterThanOrEqual(0.8);
  });

  it('returns the fallback topic when content is empty or unrelated to the catalog', () => {
    expect(classifyItemTopics('', '   ')).toEqual([{ topicId: 'other', score: 0, conceptIds: [] }]);
    expect(classifyItemTopics('No relevant material', 'A quiet morning in the city.')).toEqual([
      { topicId: 'other', score: 0, conceptIds: [] },
    ]);
  });

  it('returns the other topic when the item does not match any configured domain', () => {
    const result = classifyItemTopics('Coffee shop', 'The café opened a new menu today and people queued for pastries.');

    expect(result).toEqual([{ topicId: 'other', score: 0, conceptIds: [] }]);
  });

  it('can assign several relevant topics to one item when multiple signals overlap', () => {
    const result = classifyItemTopics(
      'Cabinet approved sanctions and the airstrike continued near the border',
      'Diplomats negotiated while the military operation intensified along the frontier.',
    );

    const topicIds = result.map(row => row.topicId);
    expect(topicIds).toEqual(expect.arrayContaining(['security_defense', 'diplomacy_relations']));
    expect(result.every(row => row.score >= 0 && row.score <= 1)).toBe(true);
  });

  it('ignores URLs and punctuation noise while still recognizing a real security signal', () => {
    const result = classifyItemTopics(
      'https://example.com/live?watch=airstrike',
      '🚨 Military alert: airstrike hits military base near the port! #breaking',
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topicId: 'security_defense', score: expect.any(Number) }),
      ]),
    );
    expect(result.find(row => row.topicId === 'security_defense')?.score).toBeGreaterThanOrEqual(0.8);
  });

  it('normalizes Arabic diacritics and letter variants before matching', () => {
    const result = classifyItemTopics('أُعلن عن قَصف جَوّي على قاعدة عسكرية', 'تمت مداهمة المنطقة بعد هجومٍ على القوات');

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topicId: 'security_defense', score: expect.any(Number) }),
      ]),
    );
    expect(result.find(row => row.topicId === 'security_defense')?.conceptIds).toContain('security_airstrike');
  });

  it('classifies a single item when text mixes multiple languages', () => {
    const result = classifyItemTopics(
      'Airstrike reported in Jerusalem',
      'הצבא שיגר טיל לעבר בסיס צבאי while Arabic reports mention a missile strike and evacuation orders.',
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topicId: 'security_defense', score: expect.any(Number) }),
      ]),
    );
    expect(result.find(row => row.topicId === 'security_defense')?.score).toBeGreaterThanOrEqual(0.8);
  });

  it('does not duplicate topic ids when multiple concept matches fall within the same category', () => {
    const result = classifyItemTopics('Israeli airstrike on a military base', 'The armed forces deployed rockets and missiles against targets.');

    expect(result.filter(row => row.topicId === 'security_defense')).toHaveLength(1);
    expect(new Set(result.map(row => row.topicId)).size).toBe(result.length);
  });

  it('falls back to other when related words are present but below the confidence threshold', () => {
    const result = classifyItemTopics(
      'Security-related update',
      'Officials discussed a possible policy change and a general sense of concern in the region.',
    );

    expect(result).toEqual([{ topicId: 'other', score: 0, conceptIds: [] }]);
    expect(result.every(row => row.score < 0.8)).toBe(true);
  });

  it('keeps the catalog synchronized to the registry used by the database startup wiring', async () => {
    const db = await createItemTestDatabase();
    try {
      expect(TOPIC_CATALOG.some(t => t.topic_id === 'security_defense')).toBe(true);
      await expect(syncClassifierTopics(db.db)).resolves.toBeUndefined();
    } finally {
      await db.pg.close();
    }
  });
});
