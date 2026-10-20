import { request, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { MEDIA_POLICY } from './policy.js';
import { MediaError } from './errors.js';
import { spoolMedia, type DownloadedMedia } from './files.js';
import { resolvePublicAddress, validateMediaUrl, type MediaResolver } from './url-policy.js';

export type MediaRequest = (url: URL, options: RequestOptions) => Promise<IncomingMessage>;

/** Exported transport seam allows real local TLS fixture tests without relaxing production URL policy. */
export const requestMedia: MediaRequest = (url, options) =>
  new Promise((resolve, reject) => {
    const req = request(url, options, resolve);
    const connect = setTimeout(() => req.destroy(new MediaError('timeout', true)), MEDIA_POLICY.connectMs);
    req.once('socket', socket => socket.once('secureConnect', () => clearTimeout(connect)));
    req.once('error', error => {
      clearTimeout(connect);
      reject(error);
    });
    req.once('response', response => {
      clearTimeout(connect);
      response.once('error', () => undefined);
    });
    req.setTimeout(MEDIA_POLICY.inactivityMs, () => req.destroy(new MediaError('timeout', true)));
    req.end();
  });

export interface DownloadDependencies {
  resolve?: MediaResolver;
  request?: MediaRequest;
}

export async function downloadMedia(
  source: string,
  directory: string,
  signal: AbortSignal,
  allowedHosts: readonly string[] = [],
  dependencies: DownloadDependencies = {},
): Promise<DownloadedMedia> {
  const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(MEDIA_POLICY.downloadMs)]);
  try {
    let url = validateMediaUrl(source, allowedHosts);
    for (let redirects = 0; redirects <= MEDIA_POLICY.maxRedirects; redirects++) {
      const destination = await resolvePublicAddress(url, downloadSignal, dependencies.resolve);
      const response = await (dependencies.request ?? requestMedia)(url, {
        signal: downloadSignal,
        agent: false,
        family: destination.family,
        lookup: (_hostname, _options, callback) => callback(null, destination.address, destination.family),
        headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'Nexus-Media/1' },
        maxHeaderSize: 16 * 1024,
      });
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy();
        if (!response.headers.location || redirects === MEDIA_POLICY.maxRedirects) throw new MediaError('unsafe_url');
        let next: string;
        try {
          next = new URL(response.headers.location, url).href;
        } catch {
          throw new MediaError('unsafe_url');
        }
        url = validateMediaUrl(next, allowedHosts);
        continue;
      }
      if (status !== 200) {
        response.destroy();
        if (status === 404 || status === 410) throw new MediaError('missing');
        if (status === 401 || status === 403) throw new MediaError('forbidden_or_expired');
        throw new MediaError(
          status === 429 || status >= 500 ? 'transient' : 'unreadable',
          status === 429 || status >= 500,
        );
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy();
        throw new MediaError('unsupported_format');
      }
      if (Number(response.headers['content-length']) > MEDIA_POLICY.maxBytes) {
        response.destroy();
        throw new MediaError('download_limit');
      }
      return await spoolMedia(response, join(directory, 'source'), downloadSignal);
    }
    throw new MediaError('unsafe_url');
  } catch (error) {
    if (downloadSignal.aborted && !signal.aborted) throw new MediaError('timeout', true);
    if (
      error instanceof Error &&
      'code' in error &&
      ['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE'].includes(String(error.code))
    ) {
      throw new MediaError('transient', true);
    }
    throw error;
  }
}
