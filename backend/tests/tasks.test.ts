import { expect, test, beforeEach } from 'bun:test';
import { openDb, insertTask, getTask } from '../src/db';
import { handleTasksRequest } from '../src/api/tasks';
import type { Task } from '../src/types';

const sample = (): Task => ({
  id: 'T1', title: 't', summary: null,
  due_at: '2026-06-10T09:30:00+02:00', remind_at: '2026-06-10T09:30:00+02:00',
  status: 'pending', priority: 2, tags: [], source: 'user',
  agent_session: null, agent_cwd: null,
  created_at: '2026-06-09T10:00:00+02:00', completed_at: null, notified_at: null,
});

let db: ReturnType<typeof openDb>;
beforeEach(() => { db = openDb(':memory:'); });

const call = (method: string, path: string, body?: unknown) => {
  const req = new Request(`http://x${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleTasksRequest(req, new URL(req.url), db, () => {});
};

test('GET /api/tasks returns []', async () => {
  const res = await call('GET', '/api/tasks');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test('POST /api/tasks creates a task', async () => {
  const res = await call('POST', '/api/tasks', {
    title: 'fix', due_at: '2026-06-10T09:30:00+02:00',
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.title).toBe('fix');
  expect(getTask(db, body.id)?.title).toBe('fix');
});

test('POST /api/tasks/:id/done flips status', async () => {
  insertTask(db, sample());
  const res = await call('POST', '/api/tasks/T1/done');
  expect(res.status).toBe(200);
  expect(getTask(db, 'T1')?.status).toBe('done');
});

test('POST /api/tasks/:id/snooze with "10m" shifts due_at and clears notified_at', async () => {
  insertTask(db, { ...sample(), notified_at: '2026-06-09T09:30:00+02:00' });
  const res = await call('POST', '/api/tasks/T1/snooze', { until: '10m' });
  expect(res.status).toBe(200);
  const t = getTask(db, 'T1')!;
  expect(t.notified_at).toBeNull();
  expect(new Date(t.due_at).getTime()).toBeGreaterThan(new Date('2026-06-09T09:30:00+02:00').getTime());
});

test('POST /api/tasks/:id/snooze with "1w" shifts due_at by ~7 days', async () => {
  insertTask(db, sample());
  const res = await call('POST', '/api/tasks/T1/snooze', { until: '1w' });
  expect(res.status).toBe(200);
  const t = getTask(db, 'T1')!;
  const shift = new Date(t.due_at).getTime() - new Date(sample().due_at).getTime();
  // default remind time may move the hour, so accept 6–8 days
  expect(shift).toBeGreaterThanOrEqual(6 * 24 * 3600_000);
  expect(shift).toBeLessThanOrEqual(8 * 24 * 3600_000);
});

test('PATCH /api/tasks/:id applies valid fields', async () => {
  insertTask(db, sample());
  const res = await call('PATCH', '/api/tasks/T1', { status: 'in_progress', priority: 1 });
  expect(res.status).toBe(200);
  const t = getTask(db, 'T1')!;
  expect(t.status).toBe('in_progress');
  expect(t.priority).toBe(1);
});

test('PATCH rejects an invalid status', async () => {
  insertTask(db, sample());
  const res = await call('PATCH', '/api/tasks/T1', { status: 'bogus' });
  expect(res.status).toBe(400);
  expect(getTask(db, 'T1')?.status).toBe('pending');
});

test('PATCH accepts the shelved status', async () => {
  insertTask(db, sample());
  const res = await call('PATCH', '/api/tasks/T1', { status: 'shelved' });
  expect(res.status).toBe(200);
  expect(getTask(db, 'T1')?.status).toBe('shelved');
});

test('PATCH maps the deprecated accantonato alias to shelved', async () => {
  insertTask(db, sample());
  const res = await call('PATCH', '/api/tasks/T1', { status: 'accantonato' });
  expect(res.status).toBe(200);
  expect(getTask(db, 'T1')?.status).toBe('shelved');
});

test('PATCH rejects a non-array tags (would corrupt later reads)', async () => {
  insertTask(db, sample());
  const res = await call('PATCH', '/api/tasks/T1', { tags: 'not-an-array' });
  expect(res.status).toBe(400);
  expect(getTask(db, 'T1')?.tags).toEqual([]);
});

test('snooze rejects a bogus until instead of storing a bad date', async () => {
  insertTask(db, sample());
  const res = await call('POST', '/api/tasks/T1/snooze', { until: 'whenever' });
  expect(res.status).toBe(400);
});

test('malformed JSON body returns 400, not 500', async () => {
  insertTask(db, sample());
  const req = new Request('http://x/api/tasks/T1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{ bad json',
  });
  const res = await handleTasksRequest(req, new URL(req.url), db, () => {});
  expect(res.status).toBe(400);
});

test('DELETE /api/tasks/:id removes', async () => {
  insertTask(db, sample());
  const res = await call('DELETE', '/api/tasks/T1');
  expect(res.status).toBe(204);
  expect(getTask(db, 'T1')).toBeNull();
});

// ---- dependency endpoints -------------------------------------------------

const sample2 = (id: string): Task => ({ ...sample(), id, title: id });

const callBc = (method: string, path: string, body: unknown, bc: (m: any) => void) => {
  const req = new Request(`http://x${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleTasksRequest(req, new URL(req.url), db, bc);
};

test('POST /api/tasks/:id/deps links and returns blocked_by', async () => {
  insertTask(db, sample2('X'));
  insertTask(db, sample2('Y'));
  const res = await call('POST', '/api/tasks/X/deps', { depends_on: 'Y' });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.blocked_by.map((b: any) => b.id)).toEqual(['Y']);
});

test('POST /api/tasks/:id/deps rejects a cycle with 409', async () => {
  insertTask(db, sample2('X'));
  insertTask(db, sample2('Y'));
  await call('POST', '/api/tasks/X/deps', { depends_on: 'Y' });
  const res = await call('POST', '/api/tasks/Y/deps', { depends_on: 'X' });
  expect(res.status).toBe(409);
});

test('POST /api/tasks/:id/deps rejects self-link with 400', async () => {
  insertTask(db, sample2('X'));
  const res = await call('POST', '/api/tasks/X/deps', { depends_on: 'X' });
  expect(res.status).toBe(400);
});

test('DELETE /api/tasks/:id/deps/:depId removes the link', async () => {
  insertTask(db, sample2('X'));
  insertTask(db, sample2('Y'));
  await call('POST', '/api/tasks/X/deps', { depends_on: 'Y' });
  const res = await call('DELETE', '/api/tasks/X/deps/Y');
  expect(res.status).toBe(204);
  const x = await (await call('GET', '/api/tasks/X')).json();
  expect(x.blocked_by).toEqual([]);
});

test('GET /api/tasks/:id includes blocks (dependents)', async () => {
  insertTask(db, sample2('X'));
  insertTask(db, sample2('Y'));
  await call('POST', '/api/tasks/X/deps', { depends_on: 'Y' });
  const y = await (await call('GET', '/api/tasks/Y')).json();
  expect(y.blocks.map((b: any) => b.id)).toEqual(['X']);
});

test('marking a prerequisite done re-broadcasts the dependent', async () => {
  insertTask(db, sample2('X'));
  insertTask(db, sample2('Y'));
  await call('POST', '/api/tasks/X/deps', { depends_on: 'Y' });
  const seen: string[] = [];
  await callBc('POST', '/api/tasks/Y/done', undefined, (m) => {
    if (m.type === 'task.updated') seen.push(m.task.id);
  });
  expect(seen).toContain('X');
});
