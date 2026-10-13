import { afterEach, describe, expect, it, vi } from 'vitest';
import { withHeartbeat } from '../apps/worker/src/heartbeat.js';
afterEach(() => { vi.useRealTimers(); });
describe('Heartbeat while database work is pending', () => {
  it('blocks acknowledgement after a background heartbeat failure', async () => {
    vi.useFakeTimers();
    const beat = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('Lost group'));
    const commit = vi.fn();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const operation = withHeartbeat(beat, async guard => { await pending; await guard(); commit(); });
    const result = expect(operation).rejects.toThrow('Lost group');
    await vi.advanceTimersByTimeAsync(2500);
    release();
    await result;
    expect(commit).not.toHaveBeenCalled(); expect(beat).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
