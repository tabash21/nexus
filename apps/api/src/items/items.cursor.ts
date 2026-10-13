import { cursorSchema, type CursorPayload } from './items.dto.js';
export function encodeCursor(item: { published_at: string; item_id: string }, scope: string): string {
  // PostgreSQL's string parser preserves microseconds but uses a space and +00.
  // Keep that precision while producing the ISO form expected by cursor validation.
  const time = item.published_at.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  return Buffer.from(JSON.stringify({ time, id: item.item_id, scope })).toString('base64url');
}
export function decodeCursor(encoded: string): CursorPayload {
  return cursorSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
}
