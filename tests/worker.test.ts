import { describe, expect, it, vi } from 'vitest';
import { processMessage } from '../apps/worker/src/process.js';
import { EventConflictError } from '@nexus/database';
import { collectorEvent, delivery, source } from './fixtures.js';
const message = () => ({ ...delivery(), timestamp: '1', key: null, value: Buffer.from(JSON.stringify(collectorEvent())) });
const dependencies = () => ({ source, ingest: vi.fn().mockResolvedValue({}), quarantine: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue(undefined) });
describe('Kafka acknowledgement boundary', () => {
  it('commits only after persistence succeeds', async () => {
    const calls: string[] = [];
    await processMessage(message(), { source, ingest: async () => { calls.push('persist'); }, quarantine: async () => {}, commit: async () => { calls.push('commit'); } });
    expect(calls).toEqual(['persist', 'commit']);
  });
  it('does not acknowledge a database outage', async () => {
    const deps = dependencies(); deps.ingest.mockRejectedValue(new Error('connection lost'));
    await expect(processMessage(message(), deps)).rejects.toThrow('connection lost');
    expect(deps.commit).not.toHaveBeenCalled(); expect(deps.quarantine).not.toHaveBeenCalled();
  });
  it('quarantines malformed bytes before acknowledging', async () => {
    const deps = dependencies(); const input = { ...message(), value: Buffer.from('{invalid') };
    await processMessage(input, deps);
    expect(deps.ingest).not.toHaveBeenCalled();
    expect(deps.quarantine).toHaveBeenCalledWith(expect.objectContaining({ valueBase64: input.value.toString('base64'), reason: 'invalid-event' }));
    expect(deps.commit).toHaveBeenCalledOnce();
  });
  it('does not acknowledge if quarantine publication fails', async () => {
    const deps = dependencies(); deps.quarantine.mockRejectedValue(new Error('broker unavailable'));
    await expect(processMessage({ ...message(), value: null }, deps)).rejects.toThrow('broker unavailable');
    expect(deps.commit).not.toHaveBeenCalled();
  });
  it('quarantines conflicting event identities', async () => {
    const deps = dependencies(); deps.ingest.mockRejectedValue(new EventConflictError('conflict'));
    await processMessage(message(), deps);
    expect(deps.quarantine).toHaveBeenCalledOnce(); expect(deps.commit).toHaveBeenCalledOnce();
  });
  it.each([{ platform: 'x' }, { realityId: 3 }, { realityId: 0 }])('quarantines mismatched platform or payload-assigned reality: %j', async changes => {
    const deps = dependencies();
    await processMessage({ ...message(), value: Buffer.from(JSON.stringify({ ...collectorEvent(), ...changes })) }, deps);
    expect(deps.ingest).not.toHaveBeenCalled(); expect(deps.quarantine).toHaveBeenCalledOnce();
  });
  it('assigns reality 0 from the real source when the payload has no reality field', async () => {
    const deps = dependencies(); const input = message();
    expect(JSON.parse(input.value.toString())).not.toHaveProperty('realityId');
    await processMessage(input, deps);
    expect(deps.ingest).toHaveBeenCalledWith(expect.objectContaining({ realityId: 0 }), input, expect.any(String));
  });
  it('always assigns reality 1 to simulation messages without requiring it in the payload', async () => {
    const deps = { ...dependencies(), source: { ...source, topic: 'sim.telegram.v1', mode: 'simulation' as const, realityId: 1 } };
    const input = { ...message(), topic: deps.source.topic };
    await processMessage(input, deps);
    expect(deps.ingest).toHaveBeenCalledWith(expect.objectContaining({ realityId: 1 }), input, expect.any(String));
    expect(deps.quarantine).not.toHaveBeenCalled();
  });
});
