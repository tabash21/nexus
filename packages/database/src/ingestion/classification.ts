import type { OsintEvent } from '@nexus/contracts';
import { classification } from '../schema/index.js';
import type { IngestTransaction } from '../types.js';
import { toBigInt } from './bigint.js';

const WEIGHTS = { CRITICAL: 0.95, HIGH: 0.75, LOW: 0.05, DEFAULT: 0.35 };
const SIGNALS = {
  CRITICAL: [
    // English
    'war crime',
    'genocide',
    'bomb',
    'terrorist',
    'massacre',
    'hostage',
    // Hebrew
    'פשעי מלחמה',
    'רצח עם',
    'פצצה',
    'מחבל',
    'טרוריסט',
    'טבח',
    'חטוף',
    'בן ערובה',
    // Arabic
    'جريمة حرب',
    'إبادة جماعية',
    'قنبلة',
    'إرهابي',
    'مجزرة',
    'رهينة',
  ],
  HIGH: [
    // English
    'attack',
    'kill',
    'explosion',
    'arrest',
    'raid',
    'riot',
    'strike',
    'ceasefire',
    'military',
    'security',
    'incident',
    'casualty',
    'evacuation',
    'shutdown',
    'explosive',
    'injury',
    'gunfire',
    'clash',
    'boycott',
    'scandal',
    'accuse',
    // Hebrew
    'תקיפה',
    'התקפה',
    'להרוג',
    'פיצוץ',
    'מעצר',
    'פשיטה',
    'מהומה',
    'שביתה',
    'צבא',
    'צבאי',
    'אבטחה',
    'ביטחון',
    'אירוע',
    'נפגע',
    'פינוי',
    'השבתה',
    'חומר נפץ',
    'פציעה',
    'ירי',
    'עימות',
    'חרם',
    'שערורייה',
    'להאשים',
    // Arabic
    'هجوم',
    'قتل',
    'انفجار',
    'اعتقال',
    'مداهمة',
    'شغب',
    'إضراب',
    'وقف إطلاق النار',
    'عسكري',
    'أمن',
    'حادث',
    'ضحية',
    'إخلاء',
    'إغلاق',
    'متفجرات',
    'إصابة',
    'إطلاق نار',
    'اشتباك',
    'مقاطعة',
    'فضيحة',
    'اتهام',
  ],
  LOW: [
    // English
    'lol',
    'haha',
    'meme',
    'funny',
    'good morning',
    'birthday',
    'coffee',
    // Hebrew
    'חחח',
    'מצחיק',
    'בוקר טוב',
    'יום הולדת',
    'קפה',
    // Arabic
    'ههههه',
    'مضحك',
    'صباح الخير',
    'عيد ميلاد',
    'قهوة',
  ],
};

export function calculateRelevance(event: OsintEvent): number {
  const text = `${event.item.title ?? ''}\n${event.item.text}`.trim().toLowerCase();
  if (!text) return 0;

  const words = text.split(/\s+/);
  const has = (list: string[]) => list.some(w => text.includes(w));
  const signalWordCount = words.filter(w => [...SIGNALS.CRITICAL, ...SIGNALS.HIGH].includes(w)).length;

  // 1. Base Score Selection
  let score = has(SIGNALS.CRITICAL)
    ? WEIGHTS.CRITICAL
    : has(SIGNALS.LOW) && !has(SIGNALS.HIGH)
      ? WEIGHTS.LOW
      : has(SIGNALS.HIGH)
        ? WEIGHTS.HIGH
        : WEIGHTS.DEFAULT;

  // 2. Word Ratio Boost: Increase score if >15% of words are signal words
  if (words.length > 0 && signalWordCount / words.length > 0.15) {
    score += 0.1;
  }

  // 3. Simple Views Modifier
  const views = toBigInt(event.engagement?.views) ?? 0;
  if (views > 10000) score += 0.1;
  if (views < 50 && score >= WEIGHTS.HIGH) score -= 0.05;

  return Number(Math.min(Math.max(score, 0), 1).toFixed(2));
}

interface ExpectedClassification {
  item_id: string;
  model: string;
  prompt_version: string;
  classified_at: string;
  content_revision: bigint;
  relevance?: number;
  misinfo_score?: number;
  sentiment?: string;
  summary_en?: string;
}

export async function saveClassification(tx: IngestTransaction, event: OsintEvent, itemId: string): Promise<void> {
  const text = event.item.text;
  if (!text) return;

  const values: ExpectedClassification & { event_id: string } = {
    event_id: event.eventId,
    item_id: itemId,
    model: '',
    prompt_version: '',
    classified_at: event.observedAt,
    content_revision: BigInt(1),
    relevance: calculateRelevance(event),
  };

  const inserted = await tx.insert(classification).values(values).onConflictDoNothing();
}
