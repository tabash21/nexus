import { LinkifyIt } from 'linkify-it';

/** Upper bound on characters sampled from title and text; keeps detection cost flat for long items. */
export const MAX_SAMPLE_CHARS = 10_000;

/**
 * Detects schemed and bare links (`t.me/x`, `bit.ly/y`, `ynet.co.il/...`) and emails against real TLDs.
 * linkify-it 6 disables bare links by default, so `fuzzyLink` is enabled explicitly.
 */
const linkify = new LinkifyIt({ fuzzyLink: true });
const MENTION_PATTERN = /(^|\s)@[\p{L}\p{N}_.]+/gu;
const LETTER_PATTERN = /\p{L}/gu;

/** Script groups that identify a language family; Japanese mixes Han and kana in one language. */
const SCRIPT_GROUPS: readonly (readonly [name: string, pattern: RegExp])[] = [
  ['latin', /\p{Script=Latin}/u],
  ['hebrew', /\p{Script=Hebrew}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['greek', /\p{Script=Greek}/u],
  ['cjk', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['devanagari', /\p{Script=Devanagari}/u],
  ['thai', /\p{Script=Thai}/u],
];

export interface PreparedText {
  /** Words written in the dominant script, joined for the detector. */
  readonly text: string;
  /** Letter count across the dominant-script words. */
  readonly letters: number;
  /** Share (0-1] of lettered words written in the dominant script; below 1 means mixed scripts. */
  readonly dominantShare: number;
}

interface ScriptBucket {
  words: string[];
  letters: number;
}

/**
 * Pure text preparation for language detection.
 * Removes URLs, emails, and @mentions, keeps hashtag words, drops tokens without letters
 * (numbers, emoji, punctuation), and keeps only the words of the dominant script.
 * Returns null when nothing language-bearing remains.
 */
export function prepareText(parts: readonly (string | null)[]): PreparedText | null {
  const joined = parts
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .slice(0, MAX_SAMPLE_CHARS);
  const sample = removeLinks(joined).replace(MENTION_PATTERN, '$1 ').replaceAll('#', ' ');

  const buckets = new Map<string, ScriptBucket>();
  let lettered = 0;
  for (const word of sample.split(/\s+/u)) {
    const letters = word.match(LETTER_PATTERN)?.length ?? 0;
    if (letters === 0) continue;
    lettered += 1;
    const script = scriptOf(word);
    const bucket = buckets.get(script) ?? { words: [], letters: 0 };
    bucket.words.push(word);
    bucket.letters += letters;
    buckets.set(script, bucket);
  }

  const dominant = dominantBucket(buckets);
  if (!dominant) return null;
  return {
    text: dominant.words.join(' '),
    letters: dominant.letters,
    dominantShare: dominant.words.length / lettered,
  };
}

/** Replaces every link and email linkify-it finds with a space, keeping surrounding text intact. */
function removeLinks(text: string): string {
  const matches = linkify.match(text) ?? [];
  let result = '';
  let cursor = 0;
  for (const { index, lastIndex } of matches) {
    result += `${text.slice(cursor, index)} `;
    cursor = lastIndex;
  }
  return result + text.slice(cursor);
}

function scriptOf(word: string): string {
  const letter = word.match(LETTER_PATTERN)?.[0] ?? '';
  return SCRIPT_GROUPS.find(([, pattern]) => pattern.test(letter))?.[0] ?? 'other';
}

/** Most words wins; ties break on letters, then script name, so the result is deterministic. */
function dominantBucket(buckets: ReadonlyMap<string, ScriptBucket>): ScriptBucket | undefined {
  return [...buckets.entries()].sort(
    ([nameA, a], [nameB, b]) => b.words.length - a.words.length || b.letters - a.letters || nameA.localeCompare(nameB),
  )[0]?.[1];
}
