/** XML parsers represent text nodes with attributes as { _: text, $: attributes }. */
export function creatorText(value: unknown): string | undefined {
  const text =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && '_' in value && typeof value._ === 'string'
        ? value._
        : undefined;
  return text?.trim() ? text : undefined;
}

/** Empty optional feed fields carry no metadata; other values still undergo validation. */
export function absentIfEmpty(value: unknown): unknown {
  return value === null || (typeof value === 'string' && !value.trim()) ? undefined : value;
}

/** Best-effort RSS publication time. Never guess a timezone or substitute collection time. */
export function publicationTime(isoDate: string | undefined, pubDate: unknown): string | undefined {
  if (isoDate) return isoDate;
  if (typeof pubDate !== 'string' || !/(?:GMT|UTC|[+-]\d{4}|[+-]\d{2}:\d{2}|Z)\s*$/i.test(pubDate)) {
    return undefined;
  }
  const timestamp = Date.parse(pubDate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}
