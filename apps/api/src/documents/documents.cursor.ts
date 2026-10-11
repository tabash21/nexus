import { cursorSchema, type CursorPayload } from './documents.dto.js';

export function encodeCursor(item: { last_seen_at: Date | string; id: string }): string {
  const payload: CursorPayload = {
    time: new Date(item.last_seen_at).toISOString(),
    id: item.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(encoded: string): CursorPayload {
  const json = Buffer.from(encoded, 'base64url').toString('utf8');
  return cursorSchema.parse(JSON.parse(json));
}
