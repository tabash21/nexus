import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingest, itemSchema } from '@nexus/database';
import { eventSchema, hash, type OsintEvent } from '@nexus/contracts';
import {
  detectLanguage, languageProcessor, prepareText, ProcessorRegistry, FULL_CONFIDENCE_LETTERS, UNRELIABLE_CONFIDENCE_CAP,
} from '../apps/enrichment-worker/src/processors/index.js';
import { delivery, event } from './fixtures.js';
import { createItemTestDatabase } from './helpers/item-database.js';

const HEBREW = 'הצבא הודיע הבוקר על פתיחת הצירים בצפון לאחר סיום הבדיקות';
const ARABIC = 'أعلن الجيش صباح اليوم عن فتح الطرق في الشمال بعد انتهاء الفحوصات';
const ENGLISH = 'The army announced this morning that roads in the north have reopened';

describe('language detection rules', () => {
  it.each([['he', HEBREW], ['ar', ARABIC], ['en', ENGLISH]])('detects %s with high confidence', (lang, text) => {
    const result = detectLanguage({ title: null, text });
    expect(result.lang).toBe(lang);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
  it('combines title and text', () => {
    expect(detectLanguage({ title: 'עדכון ביטחוני', text: HEBREW }).lang).toBe('he');
    expect(detectLanguage({ title: ENGLISH, text: '' }).lang).toBe('en');
  });
  it.each([
    ['empty', ''], ['whitespace', '   \n\t '], ['numbers and emoji', '🔥🔥 2026 !!! 123'],
    ['urls and mentions', 'https://t.me/channel/1 www.example.com @someone user@example.com'],
    ['unsupported script', 'ཀུན་ལ་བཀྲ་ཤིས་བདེ་ལེགས'],
  ])('returns unknown (null, null) for %s input', (_name, text) => {
    expect(detectLanguage({ title: null, text })).toEqual({ lang: null, confidence: null });
  });
  it.each([['latin', 'a'], ['hebrew', 'א'], ['arabic', 'ب']])('keeps a language for a single %s letter with near-zero confidence', (_name, text) => {
    const result = detectLanguage({ title: null, text });
    expect(result.lang).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1 / FULL_CONFIDENCE_LETTERS);
  });
  it('keeps a short text language but with low confidence', () => {
    const result = detectLanguage({ title: null, text: 'כן' });
    expect(result.lang).toBe('he');
    expect(result.confidence).toBeLessThan(0.2);
    expect(detectLanguage({ title: null, text: 'שלום לכולם' }).confidence).toBeLessThanOrEqual(UNRELIABLE_CONFIDENCE_CAP);
  });
  it('picks the dominant script for mixed text and lowers confidence by its share', () => {
    const mostlyHebrew = detectLanguage({ title: null, text: `${HEBREW} via Reuters` });
    const pure = detectLanguage({ title: null, text: HEBREW });
    expect(mostlyHebrew.lang).toBe('he');
    expect(mostlyHebrew.confidence).toBeLessThan(pure.confidence!);
    const mostlyEnglish = detectLanguage({ title: null, text: `${ENGLISH} שלום` });
    expect(mostlyEnglish.lang).toBe('en');
    const half = prepareText([`${ENGLISH} ${ARABIC}`]);
    expect(half?.dominantShare).toBeGreaterThan(0.4);
    expect(half?.dominantShare).toBeLessThan(0.6);
  });
  it('ignores urls, mentions, and hashtag markers', () => {
    expect(prepareText(['#חדשות @user https://x.com/a עדכון'])).toEqual({ text: 'חדשות עדכון', letters: 10, dominantShare: 1 });
  });
  it.each([
    ['telegram link', 'פיצוץ בנמל t.me/nexus_intel/42 עדכון'],
    ['shortener', 'פיצוץ בנמל bit.ly/3xYz עדכון'],
    ['bare domain with path', 'פיצוץ בנמל ynet.co.il/news/article/abc123 עדכון'],
    ['bracketed url', 'פיצוץ בנמל (https://example.com/a). עדכון'],
    ['email', 'פיצוץ בנמל desk@example.com עדכון'],
  ])('removes a %s so it does not count as a Latin word', (_name, text) => {
    expect(prepareText([text])).toMatchObject({ text: 'פיצוץ בנמל עדכון', dominantShare: 1 });
  });
  it('keeps dotted words and numbers that are not links', () => {
    expect(prepareText(['said hi.Thanks in version 2.5'])?.text).toBe('said hi.Thanks in version');
    expect(prepareText(['פיצוץ בנמל.אחרי'])?.text).toBe('פיצוץ בנמל.אחרי');
  });
  it('is deterministic', () => {
    expect(detectLanguage({ title: null, text: ARABIC })).toEqual(detectLanguage({ title: null, text: ARABIC }));
  });
});

describe('lang.v1 processor', () => {
  it('is registered and returns detection values for job contexts', async () => {
    expect(new ProcessorRegistry().find('lang', 'lang.v1')).toBe(languageProcessor);
    const job = { job_id: '1', item_id: 'i', content_revision: '1', event_id: 'e', job_type: 'lang',
      processor_version: 'lang.v1', input_hash: 'h', claim_token: 't', attempts: 1, raw_bytes: Buffer.from('{}'),
      raw_payload: {}, platform: 'telegram', title: null, content_text: ARABIC };
    const result = await languageProcessor.process({ job, signal: new AbortController().signal });
    expect(result.values).toMatchObject({ lang: 'ar' });
  });
});

describe('language projection into core.item', () => {
  let f: Awaited<ReturnType<typeof createItemTestDatabase>>;
  beforeAll(async () => { f = await createItemTestDatabase(); }, 120000);
  beforeEach(async () => { await f.pg.exec('TRUNCATE core.source,core.author,ingest.ingest_events,core.item CASCADE'); });
  afterAll(async () => { await f?.pg.close(); });

  const observe = (text: string, language?: string, observedAt = '2026-01-02T12:00:00.000Z'): OsintEvent => {
    const base = event();
    return eventSchema.parse({ ...base, eventId: randomUUID(), observedAt,
      item: { ...base.item, title: undefined, text, ...(language ? { language } : {}) } });
  };
  const save = (e: OsintEvent, offset: string, detect = true) =>
    ingest(f.db, e, delivery(offset), hash(e), `s3://test/${offset}`,
      detect ? { detectLanguage: input => languageProcessor.detect(input) } : {});
  const stored = async () => (await f.db.select().from(itemSchema.item))[0];

  it('stores detected lang and confidence separately from the platform language', async () => {
    await save(observe(HEBREW, 'en'), '0');
    const row = await stored();
    expect(row?.lang).toBe('he');
    expect(row?.lang_confidence).toBeGreaterThan(0.7);
    expect(row?.lang_confidence).toBeLessThanOrEqual(1);
    expect(row?.lang_platform).toBe('en');
  });
  it('stores null language and confidence for empty text', async () => {
    await save(observe(''), '0');
    const row = await stored();
    expect(row).toMatchObject({ lang: null, lang_confidence: null, lang_platform: null });
  });
  it('re-detects when content is edited', async () => {
    await save(observe(ENGLISH), '0');
    await save(observe(ARABIC, undefined, '2026-01-02T13:00:00.000Z'), '1');
    const row = await stored();
    expect(row?.lang).toBe('ar');
    expect(row?.content_revision).toBe(2n);
  });
  it('without a detector keeps language for unchanged content and clears it on edits', async () => {
    await save(observe(ENGLISH), '0');
    await save(observe(ENGLISH, undefined, '2026-01-02T13:00:00.000Z'), '1', false);
    expect((await stored())?.lang).toBe('en');
    await save(observe(HEBREW, undefined, '2026-01-02T14:00:00.000Z'), '2', false);
    expect(await stored()).toMatchObject({ lang: null, lang_confidence: null });
  });
});
