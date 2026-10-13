import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { WorkerService, type WorkerResources } from '../apps/worker/dist/worker.service.js';

function resources() {
  return {
    streamId: 'test', quarantineTopic: 'quarantine',
    ready: vi.fn().mockResolvedValue(undefined), ingest: vi.fn(),
    pool: { on: vi.fn(), query: vi.fn().mockResolvedValue({}), end: vi.fn().mockResolvedValue(undefined) },
    producer: { connect: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn().mockResolvedValue(undefined), send: vi.fn() },
    consumers: [{ source: {platform:'telegram',topic:'raw.telegram.v1',groupId:'test',mode:'real',realityId:0,adapter:'provisional.v1'}, consumer: {
      events: { CRASH: 'crash' }, on: vi.fn(), connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
    } }],
  };
}
describe('NestJS worker lifecycle', () => {
  it('initializes the consumer with manual acknowledgement and closes resources once', async () => {
    const r = resources();
    const worker = new WorkerService(r as unknown as WorkerResources, vi.fn());
    await worker.onModuleInit();
    expect(r.consumers[0]!.consumer.run).toHaveBeenCalledWith(expect.objectContaining({ autoCommit: false }));
    await worker.onApplicationShutdown();
    await worker.onApplicationShutdown();
    expect(r.consumers[0]!.consumer.disconnect).toHaveBeenCalledOnce();
    expect(r.producer.disconnect).toHaveBeenCalledOnce();
    expect(r.pool.end).toHaveBeenCalledOnce();
  });
  it('closes resources when startup fails before connecting to Kafka', async () => {
    const r = resources(); r.ready.mockRejectedValue(new Error('database unavailable'));
    const worker = new WorkerService(r as unknown as WorkerResources, vi.fn());
    await expect(worker.onModuleInit()).rejects.toThrow('database unavailable');
    expect(r.consumers[0]!.consumer.connect).not.toHaveBeenCalled();
    expect(r.pool.end).toHaveBeenCalledOnce();
    expect(r.producer.disconnect).toHaveBeenCalledOnce();
  });
});

