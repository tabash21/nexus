import { eld } from 'eld/medium';
import type { ItemLanguage, LanguageInput } from '@nexus/database';
import { prepareText } from './text.js';

/** Fewer letters than this cannot identify a language. */
export const MIN_LETTERS = 2;
/** Texts with at least this many dominant-script letters get full length confidence. */
export const FULL_CONFIDENCE_LETTERS = 20;
/** Ceiling applied when the detector itself reports an unreliable result. */
export const UNRELIABLE_CONFIDENCE_CAP = 0.5;

export const UNKNOWN_LANGUAGE: ItemLanguage = Object.freeze({ lang: null, confidence: null });

/**
 * Deterministic language detection from item title and text.
 *
 * - Unknown: empty input, only URLs/mentions/numbers/emoji, fewer than MIN_LETTERS letters,
 *   or a script the model does not support -> `{ lang: null, confidence: null }`.
 * - Mixed scripts: the language of the dominant script wins (by word count); confidence is
 *   scaled by that script's share of words.
 * - Short text: confidence scales linearly up to FULL_CONFIDENCE_LETTERS letters, and is capped
 *   at UNRELIABLE_CONFIDENCE_CAP when the detector marks the result unreliable.
 *
 * Confidence = modelScore x dominantShare x lengthFactor, rounded to 3 decimals, within [0, 1].
 */
export function detectLanguage({ title, text }: LanguageInput): ItemLanguage {
  const prepared = prepareText([title, text]);
  if (!prepared || prepared.letters < MIN_LETTERS) return UNKNOWN_LANGUAGE;

  const result = eld.detect(prepared.text);
  const score = result.getScores()[result.language];
  if (!result.language || score === undefined) return UNKNOWN_LANGUAGE;

  const lengthFactor = Math.min(1, prepared.letters / FULL_CONFIDENCE_LETTERS);
  let confidence = clamp(score) * prepared.dominantShare * lengthFactor;
  if (!result.isReliable()) confidence = Math.min(confidence, UNRELIABLE_CONFIDENCE_CAP);

  return { lang: result.language.toLowerCase(), confidence: Math.round(confidence * 1000) / 1000 };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
