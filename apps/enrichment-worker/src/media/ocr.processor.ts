import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { MEDIA_POLICY } from './policy.js';
import { validateImagePixels, type DownloadedMedia } from './files.js';
import { MediaError } from './errors.js';
import { runMediaTool } from './process.js';

async function checkTemporarySize(directory: string): Promise<void> {
  let size = 0;
  for (const name of await readdir(directory)) size += (await stat(join(directory, name))).size;
  if (size > MEDIA_POLICY.maxTemporaryBytes) throw new MediaError('temporary_limit');
}

function enforceTextLimit(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > MEDIA_POLICY.maxTextBytes) throw new MediaError('output_limit');
}

async function ocrImage(path: string, signal: AbortSignal): Promise<string> {
  const text = await runMediaTool(
    'tesseract',
    [path, 'stdout', '-l', MEDIA_POLICY.languages, '--oem', '1', '--psm', '3'],
    signal,
  );
  enforceTextLimit(text);
  return text;
}

export async function extractVisibleText(
  media: DownloadedMedia,
  directory: string,
  signal: AbortSignal,
): Promise<string> {
  let text: string;
  if (media.format !== 'pdf') {
    validateImagePixels(await readFile(media.path), media.format);
    text = await ocrImage(media.path, signal);
  } else {
    const info = await runMediaTool('pdfinfo', [media.path], signal);
    if (/^Encrypted:\s+yes/im.test(info)) throw new MediaError('unreadable');
    const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
    if (!Number.isSafeInteger(pages) || pages < 1) throw new MediaError('unreadable');
    if (pages > MEDIA_POLICY.maxPages) throw new MediaError('page_limit');
    const texts: string[] = [];
    for (let page = 1; page <= pages; page++) {
      const prefix = join(directory, `page-${page}`);
      const image = prefix + '.png';
      try {
        await runMediaTool(
          'pdftoppm',
          [
            '-f',
            String(page),
            '-l',
            String(page),
            '-singlefile',
            '-scale-to',
            String(MEDIA_POLICY.maxRenderSide),
            '-png',
            media.path,
            prefix,
          ],
          signal,
        );
        await checkTemporarySize(directory);
        validateImagePixels(await readFile(image), 'png');
        texts.push(await ocrImage(image, signal));
        enforceTextLimit(texts.join('\n\n'));
      } finally {
        await unlink(image).catch(() => undefined);
      }
    }
    text = texts.join('\n\n');
  }
  return text.replace(/\r\n?/g, '\n').replaceAll('\u0000', '').normalize('NFC').trim();
}
