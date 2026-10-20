import type { ItemRow, NewItem } from '../schema/index.js';

/** Detected item language. Both fields are null when the language cannot be determined. */
export interface ItemLanguage {
  lang: string | null;
  /** Detection confidence between 0 and 1. */
  confidence: number | null;
}

/** Text the detector reads: the item title and body exactly as they will be stored. */
export interface LanguageInput {
  title: string | null;
  text: string;
}

export type DetectItemLanguage = (input: LanguageInput) => ItemLanguage;

/**
 * Resolves `lang` and `lang_confidence` for the item row being written.
 * A supplied detector always wins. Without one, the previous detection is kept only while
 * title and text are unchanged; changed content clears it so a stale language is never served.
 */
export function resolveItemLanguage(
  input: LanguageInput,
  previous: ItemRow | undefined,
  contentChanged: boolean,
  detect?: DetectItemLanguage,
): Pick<NewItem, 'lang' | 'lang_confidence'> {
  if (detect) {
    const { lang, confidence } = detect(input);
    if (confidence !== null && !(confidence >= 0 && confidence <= 1)) {
      throw new RangeError(`Language confidence out of range: ${confidence}`);
    }
    return lang ? { lang, lang_confidence: confidence } : { lang: null, lang_confidence: null };
  }
  if (!previous || contentChanged) return { lang: null, lang_confidence: null };
  return { lang: previous.lang, lang_confidence: previous.lang_confidence };
}
