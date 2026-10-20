import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { MediaError } from './errors.js';

const blocked = new BlockList();
for (const [network, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, bits, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
blocked.addSubnet('3fff::', 20, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
  return false;
}

export function validateMediaUrl(value: string, allowedHosts: readonly string[] = []): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MediaError('unsafe_url');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    (allowedHosts.length > 0 && !allowedHosts.includes(hostname))
  )
    throw new MediaError('unsafe_url');
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new MediaError('unsafe_url');
  url.hash = '';
  return url;
}

export interface MediaAddress {
  address: string;
  family: number;
}
export type MediaResolver = (hostname: string) => Promise<MediaAddress[]>;

export async function resolvePublicAddress(
  url: URL,
  signal: AbortSignal,
  resolve: MediaResolver = hostname => lookup(hostname, { all: true, verbatim: true }),
): Promise<MediaAddress> {
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  // Race DNS against cancellation without leaving an abort listener attached after resolution.
  const addresses = await new Promise<MediaAddress[]>((resolveResult, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    void resolve(hostname)
      .then(resolveResult, () => reject(new MediaError('transient', true)))
      .finally(() => signal.removeEventListener('abort', abort));
  });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(value => !isPublicAddress(value.address))) throw new MediaError('unsafe_url');
  return addresses[0]!;
}
