import { expect, test, beforeEach } from 'bun:test';
import { openDb, listTasks, insertTask, findTaskByMatch, getTask } from '../src/db';
import { handleIngestRequest, handleLinkIngestRequest } from '../src/api/ingest';
import { upsertScope, upsertClient } from '../src/config-db';
import type { Task } from '../src/types';

let db: ReturnType<typeof openDb>;
beforeEach(() => { db = openDb(':memory:'); });

const call = (body: unknown) => {
  const req = new Request('http://x/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleIngestRequest(req, db, () => {});
};

test('valid input creates a task with source=agent', async () => {
  const res = await call({ title: 'fix', when: 'tra 2 ore' });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.source).toBe('agent');
  expect(listTasks(db).length).toBe(1);
});

test('client is trimmed onto the task, absent → null', async () => {
  expect((await (await call({ title: 'offer', client: '  Acme  ' })).json()).client).toBe('Acme');
  expect((await (await call({ title: 'internal' })).json()).client).toBeNull();
});

test('a tag naming a configured client becomes the client, not a tag', async () => {
  upsertClient(db, { key: 'globex', label: 'Globex', sort: 0 });
  const body = await (await call({ title: 'release', tags: ['onprem', 'globex'] })).json();
  expect(body.tags).toEqual(['onprem']);
  expect(body.client).toBe('globex');
});

test('unparseable date returns 400', async () => {
  const res = await call({ title: 'fix', when: 'blorp' });
  expect(res.status).toBe(400);
});

test('missing title returns 400', async () => {
  const res = await call({ when: 'domani' });
  expect(res.status).toBe(400);
});

test('omitting when creates a general task with empty due/remind', async () => {
  const res = await call({ title: 'someday cleanup' });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.due_at).toBe('');
  expect(body.remind_at).toBe('');
});

test('blank when is treated as no deadline (not a 400)', async () => {
  const res = await call({ title: 'later', when: '   ' });
  expect(res.status).toBe(201);
  expect((await res.json()).due_at).toBe('');
});

test('remind_before_min sets remind_at earlier than due_at', async () => {
  const res = await call({ title: 'fix', when: 'tra 2 ore', remind_before_min: 15 });
  const body = await res.json();
  expect(new Date(body.remind_at).getTime()).toBeLessThan(new Date(body.due_at).getTime());
});

test('personal:true falls back to the personal tag when no hidden scope', async () => {
  const res = await call({ title: 'gym', when: 'domani', personal: true });
  expect((await res.json()).tags).toContain('personal');
});

test('personal:true uses the configured hidden-scope tag', async () => {
  upsertScope(db, { key: 'private', label: 'Private', tag: 'private', sort: 1 });
  const res = await call({ title: 'gym', when: 'domani', personal: true });
  const tags = (await res.json()).tags;
  expect(tags).toContain('private');
  expect(tags).not.toContain('personal');
});

const sample = (over: Partial<Task>): Task => ({
  id: 'X', title: 'resume me', summary: null, due_at: '2026-06-10T09:30:00+02:00',
  remind_at: '2026-06-10T09:30:00+02:00', status: 'pending', priority: 2, tags: [], services: [],
  source: 'agent', requester: null, client: null, closing: null, agent_session: null, agent_cwd: null,
  created_at: '2026-06-09T10:00:00+02:00', completed_at: null, notified_at: null, steps: [], ...over,
});

test('findTaskByMatch resolves an in_progress task (not just pending)', () => {
  insertTask(db, sample({ id: 'A', status: 'in_progress' }));
  expect(findTaskByMatch(db, 'resume')?.id).toBe('A');
});

test('findTaskByMatch ignores done tasks', () => {
  insertTask(db, sample({ id: 'B', status: 'done' }));
  expect(findTaskByMatch(db, 'resume')).toBeNull();
});

// ---- blocking links via ingest --------------------------------------------

const link = (body: unknown) => {
  const req = new Request('http://x/api/ingest/link', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return handleLinkIngestRequest(req, db, () => {});
};

test('ingest blocks makes the new task a prerequisite of the matched task', async () => {
  insertTask(db, sample({ id: 'X', title: 'deploy web' }));
  const res = await call({ title: 'setup infra', when: 'domani', blocks: 'deploy web' });
  expect(res.status).toBe(201);
  const newTask = await res.json();
  expect(getTask(db, 'X')!.blocked_by!.map(b => b.id)).toEqual([newTask.id]);
});

test('ingest blocked_by makes the new task depend on the matched task', async () => {
  insertTask(db, sample({ id: 'X', title: 'deploy web' }));
  const res = await call({ title: 'ship release', when: 'domani', blocked_by: 'deploy web' });
  const newTask = await res.json();
  expect(getTask(db, newTask.id)!.blocked_by!.map(b => b.id)).toEqual(['X']);
});

test('ingest with an unmatched blocks keyword still creates the task', async () => {
  const res = await call({ title: 'setup infra', when: 'domani', blocks: 'nothing-here' });
  expect(res.status).toBe(201);
  expect(listTasks(db).length).toBe(1);
});

test('POST /api/ingest/link links two existing tasks', async () => {
  insertTask(db, sample({ id: 'X', title: 'deploy web' }));
  insertTask(db, sample({ id: 'Y', title: 'ship release' }));
  const res = await link({ blocked: 'ship release', blocked_by: 'deploy web' });
  expect(res.status).toBe(201);
  expect(getTask(db, 'Y')!.blocked_by!.map(b => b.id)).toEqual(['X']);
});

test('POST /api/ingest/link 404s when a match fails', async () => {
  insertTask(db, sample({ id: 'X', title: 'deploy web' }));
  const res = await link({ blocked: 'deploy web', blocked_by: 'ghost' });
  expect(res.status).toBe(404);
});
