import { describe, expect, it, vi } from 'vitest';
import { processMessage } from '../apps/worker/src/process.js';
import { archiveRaw } from '../apps/worker/src/archive.js';
import { gunzipSync } from 'node:zlib';
import type { S3Client } from '@aws-sdk/client-s3';
import { collectorEvent, delivery, source } from './fixtures.js';

const message = () => ({ ...delivery(), timestamp: '1791958850000', key: null,
  value: Buffer.from(JSON.stringify(collectorEvent())) });
const dependencies = () => ({ source,
  archive: vi.fn().mockResolvedValue({ rawUri: 's3://test/raw/0#L1', rawSha256: 'a'.repeat(64) }),
  publish: vi.fn().mockResolvedValue(undefined),
  quarantine: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined) });

describe('raw to silver acknowledgement boundary', () => {
  it('stores original bytes and transport coordinates in a gzip archive', async () => {
    let archived: Record<string, unknown> | undefined;
    const s3 = { send: async (command: { input: { Body?: unknown; Key?: string } }) => {
      archived = { key: command.input.Key, line: JSON.parse(gunzipSync(command.input.Body as Buffer).toString('utf8')) };
      return {};
    } } as unknown as S3Client;
    const input = { ...message(), value: Buffer.from([0, 255, 1]) };
    const result = await archiveRaw(s3, 'test', input);
    expect(result.rawUri).toContain('s3://test/raw/');
    expect(archived?.line).toEqual(expect.objectContaining({ topic: input.topic, partition: input.partition,
      offset: input.offset, valueBase64: input.value.toString('base64') }));
  });
  it('archives before publishing and commits after both succeed', async () => {
    const calls: string[] = [];
    await processMessage(message(), { ...dependencies(),
      archive: async () => { calls.push('archive'); return { rawUri: 's3://test/raw/0#L1', rawSha256: 'a'.repeat(64) }; },
      publish: async () => { calls.push('publish'); },
      commit: async () => { calls.push('commit'); } });
    expect(calls).toEqual(['archive', 'publish', 'commit']);
  });
  it('does not acknowledge S3 or silver publication failures', async () => {
    const unavailable = dependencies(); unavailable.archive.mockRejectedValue(new Error('S3 unavailable'));
    await expect(processMessage(message(), unavailable)).rejects.toThrow('S3 unavailable');
    expect(unavailable.publish).not.toHaveBeenCalled(); expect(unavailable.commit).not.toHaveBeenCalled();
    const failed = dependencies(); failed.publish.mockRejectedValue(new Error('broker unavailable'));
    await expect(processMessage(message(), failed)).rejects.toThrow('broker unavailable');
    expect(failed.commit).not.toHaveBeenCalled(); expect(failed.quarantine).not.toHaveBeenCalled();
  });
  it('archives malformed bytes then quarantines before committing', async () => {
    const deps = dependencies();
    await processMessage({ ...message(), value: Buffer.from('{invalid') }, deps);
    expect(deps.archive).toHaveBeenCalledOnce(); expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.quarantine).toHaveBeenCalledWith(expect.objectContaining({ rawUri: 's3://test/raw/0#L1' }));
    expect(deps.commit).toHaveBeenCalledOnce();
  });
  it('does not acknowledge a quarantine publication failure', async () => {
    const deps = dependencies(); deps.quarantine.mockRejectedValue(new Error('broker unavailable'));
    await expect(processMessage({ ...message(), value: null }, deps)).rejects.toThrow('broker unavailable');
    expect(deps.commit).not.toHaveBeenCalled();
  });
  it.each([{ platform: 'x' }, { realityId: 3 }, { realityId: 0 }])('quarantines mismatched platform or payload reality: %j', async changes => {
    const deps = dependencies();
    await processMessage({ ...message(), value: Buffer.from(JSON.stringify({ ...collectorEvent(), ...changes })) }, deps);
    expect(deps.publish).not.toHaveBeenCalled(); expect(deps.quarantine).toHaveBeenCalledOnce();
  });
  it('assigns reality from each source topic', async () => {
    const real = dependencies(); await processMessage(message(), real);
    expect(real.publish).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: expect.objectContaining({ realityId: 0 }) }));
    const sim = { ...dependencies(), source: { ...source, topic: 'sim.telegram.v1', mode: 'simulation' as const, realityId: 1 } };
    await processMessage({ ...message(), topic: sim.source.topic }, sim);
    expect(sim.publish).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: expect.objectContaining({ realityId: 1 }) }));
  });
});
