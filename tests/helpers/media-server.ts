import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { downloadMedia, requestMedia } from '../../apps/enrichment-worker/dist/media/downloader.js';

/** Real TLS transport with a fixture-only route to localhost; production rejects this destination. */
export async function createMediaFixtureServer(files: Map<string, Buffer>) {
  const cert = await readFile(new URL('../fixtures/media/cert.pem', import.meta.url));
  const key = await readFile(new URL('../fixtures/media/key.pem', import.meta.url));
  const requests = new Map<string, number>();
  const expired = new Set<string>();
  const server = createServer({ cert, key }, (request, response) => {
    const path = new URL(request.url ?? '/', 'https://media.nexus.test').pathname;
    requests.set(path, (requests.get(path) ?? 0) + 1);
    if (expired.has(path)) {
      response.writeHead(403).end();
      return;
    }
    if (path === '/redirect-private') {
      response.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data' }).end();
      return;
    }
    const file = files.get(path);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(file);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    requests,
    expired,
    download: (url: string, directory: string, signal: AbortSignal) =>
      downloadMedia(url, directory, signal, ['media.nexus.test'], {
        resolve: async () => [{ address: '93.184.216.34', family: 4 }],
        request: (destination, options) =>
          requestMedia(destination, {
            ...options,
            port,
            ca: cert,
            lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4),
          }),
      }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    },
  };
}
