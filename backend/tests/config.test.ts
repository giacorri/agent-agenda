import { expect, test, beforeEach } from 'bun:test';
import { openDb } from '../src/db';
import {
  configStatus, configBundle, bootstrap,
  upsertCategory, listCategories,
  upsertPerson, upsertClient, listClients, upsertRef, upsertScope,
  patchSettings, getSettings, hiddenScopeTag, reminderDefaults,
} from '../src/config-db';
import { handleConfigRequest } from '../src/api/config';
import type { Category } from '../src/types';

let db: ReturnType<typeof openDb>;
beforeEach(() => { db = openDb(':memory:'); });

const noop = () => {};

const cat = (over: Partial<Category> = {}): Category => ({
  key: 'web', label: 'Web', icon: 'shield', color: '#a78bfa', kind: 'service', sort: 0, ...over,
});

// ---- DB layer -------------------------------------------------------------

test('fresh DB reports first-run (not configured, zero counts)', () => {
  const s = configStatus(db);
  expect(s.configured).toBe(false);
  expect(s.counts).toEqual({ categories: 0, people: 0, clients: 0, refs: 0, scopes: 0, settings: 0 });
});

test('ships empty: bundle has no seeded defaults', () => {
  const b = configBundle(db);
  expect(b.categories).toEqual([]);
  expect(b.people).toEqual([]);
  expect(b.clients).toEqual([]);
  expect(b.refs).toEqual([]);
  expect(b.scopes).toEqual([]);
  expect(b.settings).toEqual({});
});

test('category upsert round-trips and overwrites by key', () => {
  upsertCategory(db, cat());
  upsertCategory(db, cat({ label: 'Web renamed', sort: 5 }));
  const all = listCategories(db);
  expect(all.length).toBe(1);
  expect(all[0].label).toBe('Web renamed');
  expect(all[0].sort).toBe(5);
});

test('categories list is ordered by sort then key', () => {
  upsertCategory(db, cat({ key: 'b', sort: 2 }));
  upsertCategory(db, cat({ key: 'a', sort: 2 }));
  upsertCategory(db, cat({ key: 'c', sort: 1 }));
  expect(listCategories(db).map(c => c.key)).toEqual(['c', 'a', 'b']);
});

test('settings patch merges and survives readback', () => {
  patchSettings(db, { default_remind_time: '09:30', locale: 'it' });
  patchSettings(db, { locale: 'en' });
  expect(getSettings(db)).toEqual({ default_remind_time: '09:30', locale: 'en' });
});

test('bootstrap applies a whole doc and is idempotent', () => {
  const doc = {
    categories: [cat()],
    people: [{ key: 'alice', label: 'Alice', role: 'manager', sort: 0 }],
    clients: [{ key: 'acme', label: 'Acme', sort: 0 }],
    refs: [{ shorthand: 'web', owner_repo: 'acme/web-app', host: 'github.com' }],
    scopes: [{ key: 'work', label: 'Work', tag: '', sort: 0 }],
    settings: { locale: 'it' },
  };
  bootstrap(db, doc);
  const first = configStatus(db);
  expect(first.configured).toBe(true);
  expect(first.counts).toEqual({ categories: 1, people: 1, clients: 1, refs: 1, scopes: 1, settings: 1 });

  bootstrap(db, doc); // re-apply → no duplicate rows
  expect(configStatus(db).counts).toEqual(first.counts);
});

test('status is configured when any single table has rows', () => {
  upsertPerson(db, { key: 'X', label: 'X', role: '', sort: 0 });
  expect(configStatus(db).configured).toBe(true);
});

test('client upsert round-trips, overwrites by key and keeps the logo', () => {
  upsertClient(db, { key: 'acme', label: 'Acme', sort: 0, logo: 'data:image/png;base64,AA' });
  upsertClient(db, { key: 'acme', label: 'Acme Inc', sort: 2, logo: 'data:image/png;base64,AA' });
  expect(listClients(db)).toEqual([{ key: 'acme', label: 'Acme Inc', sort: 2, logo: 'data:image/png;base64,AA' }]);
});

test('reminderDefaults falls back to 09:30 / 0 when unset', () => {
  expect(reminderDefaults(db)).toEqual({ hour: 9, minute: 30, remindBeforeMin: 0 });
});

test('reminderDefaults reads configured time and remind-before', () => {
  patchSettings(db, { default_remind_time: '08:15', default_remind_before_min: '30' });
  expect(reminderDefaults(db)).toEqual({ hour: 8, minute: 15, remindBeforeMin: 30 });
});

test('reminderDefaults clamps out-of-range time to fallback bounds', () => {
  patchSettings(db, { default_remind_time: '99:99' });
  expect(reminderDefaults(db)).toEqual({ hour: 23, minute: 59, remindBeforeMin: 0 });
});

test('hiddenScopeTag returns the first tagged scope, null when none', () => {
  expect(hiddenScopeTag(db)).toBeNull();
  upsertScope(db, { key: 'work', label: 'Work', tag: '', sort: 0 });
  expect(hiddenScopeTag(db)).toBeNull(); // empty-tag scope is the default, not hidden
  upsertScope(db, { key: 'personal', label: 'Personal', tag: 'personal', sort: 1 });
  expect(hiddenScopeTag(db)).toBe('personal');
});

// ---- HTTP handler ---------------------------------------------------------

const call = (method: string, path: string, body?: unknown) => {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const req = new Request(`http://x${path}`, init);
  return handleConfigRequest(req, new URL(req.url), db, noop);
};

test('GET /api/config/status over HTTP', async () => {
  const res = await call('GET', '/api/config/status');
  expect(res.status).toBe(200);
  expect((await res.json()).configured).toBe(false);
});

test('POST then GET an entity over HTTP', async () => {
  const created = await call('POST', '/api/config/categories', cat());
  expect(created.status).toBe(201);
  const list = await (await call('GET', '/api/config/categories')).json();
  expect(list.map((c: Category) => c.key)).toEqual(['web']);
});

test('POST category without key is rejected 400', async () => {
  const res = await call('POST', '/api/config/categories', { label: 'no key' });
  expect(res.status).toBe(400);
});

test('PATCH merges fields and keeps the URL key', async () => {
  await call('POST', '/api/config/categories', cat());
  const res = await call('PATCH', '/api/config/categories/web', { color: '#000000' });
  const updated = await res.json();
  expect(updated.key).toBe('web');
  expect(updated.color).toBe('#000000');
  expect(updated.label).toBe('Web'); // untouched
});

test('PATCH on missing entity is 404', async () => {
  const res = await call('PATCH', '/api/config/categories/ghost', { color: '#fff' });
  expect(res.status).toBe(404);
});

test('DELETE removes the entity', async () => {
  await call('POST', '/api/config/people', { key: 'Jane', label: 'Jane', role: '' });
  const del = await call('DELETE', '/api/config/people/Jane');
  expect(del.status).toBe(204);
  expect(await (await call('GET', '/api/config/people')).json()).toEqual([]);
});

test('refs require owner_repo and key off shorthand', async () => {
  expect((await call('POST', '/api/config/refs', { shorthand: 'web' })).status).toBe(400);
  const ok = await call('POST', '/api/config/refs', { shorthand: 'web', owner_repo: 'acme/web-app' });
  expect(ok.status).toBe(201);
  expect((await ok.json()).host).toBe('github.com');
});

test('clients CRUD over HTTP, logo defaults to empty', async () => {
  expect((await call('POST', '/api/config/clients', { label: 'no key' })).status).toBe(400);
  const created = await call('POST', '/api/config/clients', { key: 'globex', label: 'Globex' });
  expect(created.status).toBe(201);
  expect((await created.json()).logo).toBe('');
  const patched = await (await call('PATCH', '/api/config/clients/globex', { logo: '/globex.png' })).json();
  expect(patched).toEqual({ key: 'globex', label: 'Globex', sort: 0, logo: '/globex.png' });
  expect((await call('DELETE', '/api/config/clients/globex')).status).toBe(204);
  expect(await (await call('GET', '/api/config/clients')).json()).toEqual([]);
});

test('PATCH /api/config/settings merges', async () => {
  await call('PATCH', '/api/config/settings', { a: '1' });
  const res = await call('PATCH', '/api/config/settings', { b: '2' });
  expect(await res.json()).toEqual({ a: '1', b: '2' });
});

test('config.updated is broadcast on mutation', async () => {
  let msgs: string[] = [];
  const req = new Request('http://x/api/config/categories', {
    method: 'POST', body: JSON.stringify(cat()), headers: { 'Content-Type': 'application/json' },
  });
  await handleConfigRequest(req, new URL(req.url), db, (m) => msgs.push(m.type));
  expect(msgs).toContain('config.updated');
});
