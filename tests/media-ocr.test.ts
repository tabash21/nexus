import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { extractVisibleText } from '../apps/enrichment-worker/src/media/ocr.processor.js';
import { requireMediaTools, runMediaTool } from '../apps/enrichment-worker/src/media/process.js';
import { blankMediaPng, mediaPdf } from './helpers/media-fixtures.js';
import type { MediaFormat } from '../apps/enrichment-worker/src/media/policy.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function fixture(bytes: Buffer, format: MediaFormat) {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-ocr-test-'));
  directories.push(directory);
  const path = join(directory, 'source');
  await writeFile(path, bytes);
  return {
    directory,
    media: { path, format, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
  };
}

describe.skipIf(process.env.RUN_MEDIA_NATIVE !== 'true')('real local Tesseract and Poppler', () => {
  it('checks all required languages and native tools', async () => {
    await requireMediaTools(AbortSignal.timeout(30000));
  }, 60000);
  it('extracts every PDF page in order from rendered visible pixels', async () => {
    const { directory, media } = await fixture(mediaPdf(['NEXUS PAGE ONE', 'NEXUS PAGE TWO']), 'pdf');
    const text = await extractVisibleText(media, directory, AbortSignal.timeout(60000));
    expect(text).toContain('NEXUS PAGE ONE');
    expect(text).toContain('NEXUS PAGE TWO');
    expect(text.indexOf('ONE')).toBeLessThan(text.indexOf('TWO'));
  }, 60000);
  it.each(['png', 'jpeg'] as const)(
    'extracts visible text from a real %s image',
    async format => {
      const { directory, media } = await fixture(mediaPdf(['NEXUS IMAGE TEST']), 'pdf');
      const prefix = join(directory, 'fixture');
      await runMediaTool(
        'pdftoppm',
        ['-singlefile', '-scale-to', '1800', `-${format}`, media.path, prefix],
        AbortSignal.timeout(30000),
      );
      const path = prefix + (format === 'jpeg' ? '.jpg' : '.png');
      const bytes = await readFile(path);
      const text = await extractVisibleText(
        { ...media, path, size: bytes.length, format },
        directory,
        AbortSignal.timeout(30000),
      );
      expect(text).toContain('NEXUS IMAGE TEST');
    },
    60000,
  );
  it('returns an empty string for a text-free image', async () => {
    const { directory, media } = await fixture(blankMediaPng(), 'png');
    expect(await extractVisibleText(media, directory, AbortSignal.timeout(30000))).toBe('');
  }, 30000);
  it.each([
    ['שלום עולם', /שלום|עולם/],
    ['مرحبا بالعالم', /مرحبا|بالعالم/],
  ] as const)(
    'recognizes the installed language in %s',
    async (text, expected) => {
      const f = await fixture(blankMediaPng(), 'png');
      const path = join(f.directory, 'language.png');
      await promisify(execFile)('pango-view', [
        '--no-display',
        '--font=DejaVu Sans 48',
        '--margin=40',
        `--text=${text}`,
        `--output=${path}`,
      ]);
      expect(await extractVisibleText({ ...f.media, path }, f.directory, AbortSignal.timeout(30000))).toMatch(expected);
    },
    30000,
  );
  it('rejects corrupt documents and PDFs over the page limit', async () => {
    const corrupt = await fixture(Buffer.from('%PDF-broken'), 'pdf');
    await expect(extractVisibleText(corrupt.media, corrupt.directory, AbortSignal.timeout(30000))).rejects.toThrow(
      'unreadable',
    );
    const large = await fixture(mediaPdf(Array.from({ length: 11 }, () => 'TOO MANY PAGES')), 'pdf');
    await expect(extractVisibleText(large.media, large.directory, AbortSignal.timeout(30000))).rejects.toThrow(
      'page_limit',
    );
  }, 60000);
  it('cancels native processes', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runMediaTool('tesseract', ['--list-langs'], controller.signal)).rejects.toBeDefined();
  });
});
