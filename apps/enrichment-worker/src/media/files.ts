import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MEDIA_POLICY, type MediaFormat } from './policy.js';
import { MediaError } from './errors.js';

export interface DownloadedMedia {
  path: string;
  format: MediaFormat;
  sha256: string;
  size: number;
}

export async function spoolMedia(source: Readable, path: string, signal: AbortSignal): Promise<DownloadedMedia> {
  const hash = createHash('sha256');
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > MEDIA_POLICY.maxBytes) return callback(new MediaError('download_limit'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(source, limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal });
  const bytes = await readFile(path);
  return { path, size, sha256: hash.digest('hex'), format: detectMediaFormat(bytes) };
}

export function detectMediaFormat(bytes: Buffer): MediaFormat {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  throw new MediaError('unsupported_format');
}

/** Inspect bounded headers before handing images to a native decoder. */
export function validateImagePixels(bytes: Buffer, format: 'png' | 'jpeg'): void {
  let width = 0;
  let height = 0;
  if (format === 'png') {
    if (bytes.length < 33 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13) {
      throw new MediaError('unreadable');
    }
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
    // APNG is outside the single-image v1 contract.
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') throw new MediaError('unsupported_format');
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) throw new MediaError('unreadable');
      offset += length + 12;
    }
  } else {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 0xff) throw new MediaError('unreadable');
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) throw new MediaError('unreadable');
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) throw new MediaError('unreadable');
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!width || !height) throw new MediaError('unreadable');
  if (width * height > MEDIA_POLICY.maxPixels) throw new MediaError('pixel_limit');
}
