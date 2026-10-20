import { execFile } from 'node:child_process';
import { MEDIA_POLICY } from './policy.js';
import { MediaError } from './errors.js';

/** Fixed executables and generated local paths only; never invoke a shell. */
export function runMediaTool(
  command: 'tesseract' | 'pdfinfo' | 'pdftoppm',
  args: string[],
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'prlimit',
      ['--as=1073741824', '--cpu=30', `--fsize=${MEDIA_POLICY.maxTemporaryBytes}`, '--', command, ...args],
      {
        signal,
        shell: false,
        timeout: MEDIA_POLICY.processMs,
        killSignal: 'SIGKILL',
        maxBuffer: MEDIA_POLICY.maxTextBytes,
        env: { ...process.env, OMP_THREAD_LIMIT: '1', LC_ALL: 'C' },
      },
      (error, stdout) => {
        clearTimeout(forceKill);
        if (!error) return resolve(stdout);
        if (signal.aborted) return reject(signal.reason);
        if (error.code === 'ENOENT') return reject(new MediaError('infrastructure', true));
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(new MediaError('output_limit'));
        if (error.signal === 'SIGXFSZ') return reject(new MediaError('temporary_limit'));
        if (error.signal === 'SIGXCPU') return reject(new MediaError('timeout', true));
        if (error.killed || error.signal === 'SIGKILL') return reject(new MediaError('timeout', true));
        reject(new MediaError('unreadable'));
      },
    );
    // AbortSignal cancellation sends SIGKILL too; the explicit deadline is a final safeguard.
    const forceKill = setTimeout(() => child.kill('SIGKILL'), MEDIA_POLICY.processMs + 1000);
    forceKill.unref();
  });
}

export async function requireMediaTools(signal: AbortSignal): Promise<void> {
  const languages = await runMediaTool('tesseract', ['--list-langs'], signal);
  for (const language of MEDIA_POLICY.languages.split('+')) {
    if (!languages.split(/\r?\n/).some(line => line.trim() === language)) {
      throw new Error(`Required OCR language is not installed: ${language}`);
    }
  }
  await runMediaTool('pdfinfo', ['-v'], signal);
  await runMediaTool('pdftoppm', ['-v'], signal);
}
