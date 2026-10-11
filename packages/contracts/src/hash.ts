import { createHash } from 'node:crypto';

// Stable object-key order avoids new versions caused only by JSON key ordering.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

export function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
