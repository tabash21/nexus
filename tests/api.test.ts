import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
// Test compiled decorators and metadata exactly as the production application runs.
import { buildApp } from '../apps/api/dist/app.js';

const token = 'test-token-with-at-least-24-characters';
const headers = { authorization: 'Bearer ' + token };
const repo = () => ({ ready: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) });
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function setup() {
  const db = repo();
  const app = await buildApp(db, token);
  apps.push(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  return { db, app, request: (path: string, authenticated = true) => fetch('http://127.0.0.1:' + address.port + path, {
    headers: authenticated ? headers : undefined,
  }) };
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
describe('NestJS item API', () => {
  it('requires authentication for items', async () => {
    const { request, db } = await setup();
    expect((await request('/v1/items', false)).status).toBe(401);
    expect(db.list).not.toHaveBeenCalled();
  });
  it('reports readiness failure without exposing database errors', async () => {
    const { request, db } = await setup(); db.ready.mockRejectedValue(new Error('secret connection string'));
    const response = await request('/health/ready', false);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret');
  });
  it.each(['limit=101', 'cursor=invalid', 'from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z'])('rejects invalid pagination or filters: %s', async query => {
    const { request, db } = await setup();
    expect((await request('/v1/items?' + query)).status).toBe(400);
    expect(db.list).not.toHaveBeenCalled();
  });
  it('returns and accepts a cursor without returning the look-ahead row', async () => {
    const { request, db } = await setup();
    const item = { item_id: 'test-item', published_at: '2026-01-01T00:00:00Z', content_revision: 1n };
    db.list.mockResolvedValueOnce([item, item]);
    const page = await (await request('/v1/items?limit=1')).json();
    expect(page.items).toHaveLength(1); expect(page.nextCursor).toBeTruthy();
    await request('/v1/items?cursor=' + page.nextCursor);
    expect(db.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: expect.objectContaining({ time: item.published_at, id: item.item_id }) }));
  });
  it('returns 404 for an unknown item', async () => {
    const { request } = await setup();
    expect((await request('/v1/items/11111111-1111-4111-8111-111111111111')).status).toBe(404);
  });
  it('closes the database through the NestJS shutdown lifecycle', async () => {
    const closeDatabase = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(repo(), token, { closeDatabase });
    await app.init();
    await app.close();
    expect(closeDatabase).toHaveBeenCalledOnce();
  });
});

