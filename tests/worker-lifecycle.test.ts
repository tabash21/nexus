import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { WorkerService, type WorkerResources } from '../apps/worker/dist/worker.service.js';

function resources() {
  return {
    streamId: 'test', topic: 'raw', quarantineTopic: 'quarantine',
    pool: { on: vi.fn(), query: vi.fn().mockResolvedValue({}), end: vi.fn().mockResolvedValue(undefined) },
    producer: { connect: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn().mockResolvedValue(undefined), send: vi.fn() },
    consumer: {
      events: { CRASH: 'crash' }, on: vi.fn(), connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
    },
  };
}
describe('NestJS worker lifecycle', () => {
  it('initializes the consumer with manual acknowledgement and closes resources once', async () => {
    const r = resources();
    const worker = new WorkerService(r as unknown as WorkerResources, vi.fn());
    await worker.onModuleInit();
    expect(r.consumer.run).toHaveBeenCalledWith(expect.objectContaining({ autoCommit: false }));
    await worker.onApplicationShutdown();
    await worker.onApplicationShutdown();
    expect(r.consumer.disconnect).toHaveBeenCalledOnce();
    expect(r.producer.disconnect).toHaveBeenCalledOnce();
    expect(r.pool.end).toHaveBeenCalledOnce();
  });
  it('closes resources when startup fails before connecting to Kafka', async () => {
    const r = resources(); r.pool.query.mockRejectedValue(new Error('database unavailable'));
    const worker = new WorkerService(r as unknown as WorkerResources, vi.fn());
    await expect(worker.onModuleInit()).rejects.toThrow('database unavailable');
    expect(r.consumer.connect).not.toHaveBeenCalled();
    expect(r.pool.end).toHaveBeenCalledOnce();
    expect(r.producer.disconnect).toHaveBeenCalledOnce();
  });
});

