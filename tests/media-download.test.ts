import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadMedia, type MediaRequest } from '../apps/enrichment-worker/src/media/downloader.js';
import {
  isPublicAddress,
  resolvePublicAddress,
  validateMediaUrl,
} from '../apps/enrichment-worker/src/media/url-policy.js';
import { detectMediaFormat, validateImagePixels } from '../apps/enrichment-worker/src/media/files.js';
import { MEDIA_POLICY } from '../apps/enrichment-worker/src/media/policy.js';
import { blankMediaPng } from './helpers/media-fixtures.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'nexus-download-test-'));
  directories.push(path);
  return path;
}
function response(bytes: Buffer, status = 200, headers: IncomingMessage['headers'] = {}) {
  const result = new IncomingMessage(new Socket());
  result.statusCode = status;
  result.headers = headers;
  result.push(bytes);
  result.push(null);
  return result;
}
const resolvePublic = async () => [{ address: '93.184.216.34', family: 4 }];

describe('media URL policy and bounded downloading', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.168.1.1',
    '0.0.0.0',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])('blocks nonpublic destination %s', address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each([
    'https://127.1/x',
    'https://2130706433/x',
    'https://0x7f000001/x',
    'file:///tmp/x',
    'ftp://example.com/x',
    'http://example.com/x',
    'https://user:secret@example.com/x',
    'https://example.com:8443/x',
    'https://[::1]/x',
  ])('rejects unsafe source %s', source => {
    expect(() => validateMediaUrl(source)).toThrow('unsafe_url');
  });
  it('allows public IPv4/IPv6 and applies exact hostname allowlists', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(() => validateMediaUrl('https://evil.example', ['media.example'])).toThrow();
    expect(validateMediaUrl('https://media.example/file', ['media.example']).hostname).toBe('media.example');
  });
  it('rejects mixed DNS answers and cancels stalled DNS', async () => {
    await expect(
      resolvePublicAddress(new URL('https://media.example'), new AbortController().signal, async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toThrow('unsafe_url');
    const controller = new AbortController();
    const pending = resolvePublicAddress(
      new URL('https://media.example'),
      controller.signal,
      () => new Promise(() => undefined),
    );
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });
  it('streams exact bytes, sniffs format, and pins the validated address', async () => {
    const bytes = blankMediaPng();
    const request: MediaRequest = vi.fn(async (_url, options) => {
      expect(options.family).toBe(4);
      expect(options.lookup).toBeTypeOf('function');
      expect(options.headers).toMatchObject({ 'Accept-Encoding': 'identity' });
      return response(bytes, 200, { 'content-type': 'application/octet-stream' });
    });
    const file = await downloadMedia(
      'https://media.example/a.php',
      await directory(),
      new AbortController().signal,
      [],
      { resolve: resolvePublic, request },
    );
    expect(file.format).toBe('png');
    expect(file.size).toBe(bytes.length);
    expect(await readFile(file.path)).toEqual(bytes);
  });
  it('revalidates redirects before issuing another request', async () => {
    const request = vi.fn(async () => response(Buffer.alloc(0), 302, { location: 'https://169.254.169.254/latest' }));
    await expect(
      downloadMedia('https://media.example/a', await directory(), new AbortController().signal, [], {
        resolve: resolvePublic,
        request,
      }),
    ).rejects.toThrow('unsafe_url');
    expect(request).toHaveBeenCalledOnce();
  });
  it('bounds redirect loops and resolves relative destinations', async () => {
    const request = vi.fn(async () => response(Buffer.alloc(0), 302, { location: '/next' }));
    await expect(
      downloadMedia('https://media.example/a', await directory(), new AbortController().signal, [], {
        resolve: resolvePublic,
        request,
      }),
    ).rejects.toThrow('unsafe_url');
    expect(request).toHaveBeenCalledTimes(4);
  });
  it.each([
    [404, 'missing'],
    [410, 'missing'],
    [403, 'forbidden_or_expired'],
    [401, 'forbidden_or_expired'],
    [429, 'transient'],
    [503, 'transient'],
  ])('classifies HTTP %s as %s', async (status, outcome) => {
    await expect(
      downloadMedia('https://media.example/a', await directory(), new AbortController().signal, [], {
        resolve: resolvePublic,
        request: async () => response(Buffer.alloc(0), Number(status)),
      }),
    ).rejects.toThrow(String(outcome));
  });
  it('rejects oversized bodies without trusting Content-Length', async () => {
    await expect(
      downloadMedia('https://media.example/a', await directory(), new AbortController().signal, [], {
        resolve: resolvePublic,
        request: async () => response(Buffer.alloc(MEDIA_POLICY.maxBytes + 1)),
      }),
    ).rejects.toThrow('download_limit');
  });
  it('rejects encoded bodies and unsupported content', async () => {
    await expect(
      downloadMedia('https://media.example/a', await directory(), new AbortController().signal, [], {
        resolve: resolvePublic,
        request: async () => response(blankMediaPng(), 200, { 'content-encoding': 'gzip' }),
      }),
    ).rejects.toThrow('unsupported_format');
    expect(() => detectMediaFormat(Buffer.from('<html>login</html>'))).toThrow('unsupported_format');
  });
  it('checks image dimensions before decoding and rejects corrupt headers', () => {
    const bytes = blankMediaPng();
    expect(() => validateImagePixels(bytes, 'png')).not.toThrow();
    bytes.writeUInt32BE(100000, 16);
    expect(() => validateImagePixels(bytes, 'png')).toThrow('pixel_limit');
    expect(() => validateImagePixels(Buffer.from([0xff, 0xd8, 0xff]), 'jpeg')).toThrow('unreadable');
  });
});
