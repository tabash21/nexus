export const MEDIA_POLICY = {
  maxBytes: 20 * 1024 * 1024,
  maxPixels: 20_000_000,
  maxPages: 10,
  maxRenderSide: 4096,
  maxTextBytes: 1024 * 1024,
  maxTemporaryBytes: 256 * 1024 * 1024,
  connectMs: 5000,
  inactivityMs: 10000,
  downloadMs: 30000,
  processMs: 30000,
  attemptMs: 180000,
  maxRedirects: 3,
  languages: 'eng+heb+ara',
} as const;

export type MediaFormat = 'png' | 'jpeg' | 'pdf';
