import { expect, test, beforeEach } from 'bun:test';
import { openDb, insertTask, listTasks, updateTask, deleteTask, getTask, insertNote,
         addDep, removeDep, openBlockers, dependents, wouldCycle, dueTasks, absorbClientTags } from '../src/db';
import { upsertClient, deleteClient } from '../src/config-db';
import type { Note, Task } from '../src/types';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const sample = (): Task => ({
  id: 'T1',
  title: 'fix repo',
  summary: null,
  due_at: '2026-06-10T09:30:00+02:00',
  remind_at: '2026-06-10T09:30:00+02:00',
  status: 'pending',
  priority: 2,
  tags: ['repo-x'],
  source: 'agent',
  agent_session: 's1',
  agent_cwd: '/tmp',
  created_at: '2026-06-09T10:00:00+02:00',
  completed_at: null,
  notified_at: null,
});

let db: ReturnType<typeof openDb>;
beforeEach(() => { db = openDb(':memory:'); });

test('insert + get round-trip preserves tags array', () => {
  insertTask(db, sample());
  const got = getTask(db, 'T1');
  expect(got?.tags).toEqual(['repo-x']);
  expect(got?.status).toBe('pending');
});

test('listTasks filters by status', () => {
  insertTask(db, { ...sample(), id: 'A', status: 'pending' });
  insertTask(db, { ...sample(), id: 'B', status: 'done' });
  expect(listTasks(db, { status: 'pending' }).map(t => t.id)).toEqual(['A']);
});

test('listTasks filters by date range', () => {
  insertTask(db, { ...sample(), id: 'A', due_at: '2026-06-10T09:30:00+02:00' });
  insertTask(db, { ...sample(), id: 'B', due_at: '2026-06-20T09:30:00+02:00' });
  const got = listTasks(db, { from: '2026-06-15T00:00:00+02:00', to: '2026-06-25T00:00:00+02:00' });
  expect(got.map(t => t.id)).toEqual(['B']);
});

test('updateTask merges partial fields', () => {
  insertTask(db, sample());
  updateTask(db, 'T1', { status: 'done', completed_at: '2026-06-10T10:00:00+02:00' });
  expect(getTask(db, 'T1')?.status).toBe('done');
});

test('deleteTask removes the row', () => {
  insertTask(db, sample());
  deleteTask(db, 'T1');
  expect(getTask(db, 'T1')).toBeNull();
});

const note = (id: string, body: string, created_at: string): Note => ({
  id, task_id: 'T1', body, kind: 'text', created_at, agent_session: null,
});

test('listTasks carries note_count + newest last_note', () => {
  insertTask(db, sample());
  insertNote(db, note('n1', 'first step', '2026-06-09T11:00:00+02:00'));
  insertNote(db, note('n2', 'second step', '2026-06-09T12:00:00+02:00'));
  const [t] = listTasks(db, { status: 'pending' });
  expect(t.note_count).toBe(2);
  expect(t.last_note?.body).toBe('second step');
  expect(t.last_note?.kind).toBe('text');
});

test('listTasks reports zero notes as empty preview', () => {
  insertTask(db, sample());
  const [t] = listTasks(db);
  expect(t.note_count).toBe(0);
  expect(t.last_note).toBeNull();
});

// ---- task dependencies (blocking links) -----------------------------------

const mk = (id: string, over: Partial<Task> = {}): Task => ({ ...sample(), id, title: id, ...over });
const NOW = '2026-06-09T10:00:00+02:00';

test('openBlockers lists open prerequisites; dependents lists the other way', () => {
  insertTask(db, mk('X'));
  insertTask(db, mk('Y'));
  addDep(db, 'X', 'Y', NOW); // X depends on Y
  expect(openBlockers(db, 'X').map(b => b.id)).toEqual(['Y']);
  expect(dependents(db, 'Y').map(b => b.id)).toEqual(['X']);
});

test('a shelved prerequisite drops out of openBlockers', () => {
  insertTask(db, mk('X'));
  insertTask(db, mk('Y', { status: 'shelved' }));
  addDep(db, 'X', 'Y', NOW);
  expect(openBlockers(db, 'X')).toEqual([]);
});

test('a done prerequisite drops out of openBlockers', () => {
  insertTask(db, mk('X'));
  insertTask(db, mk('Y', { status: 'done' }));
  addDep(db, 'X', 'Y', NOW);
  expect(openBlockers(db, 'X')).toEqual([]);
});

test('addDep rejects self-link, duplicate, and cycle', () => {
  insertTask(db, mk('X'));
  insertTask(db, mk('Y'));
  expect(addDep(db, 'X', 'X', NOW)).toMatchObject({ ok: false, code: 400 });
  expect(addDep(db, 'X', 'Y', NOW)).toEqual({ ok: true });
  expect(addDep(db, 'X', 'Y', NOW)).toMatchObject({ ok: false, code: 409 }); // duplicate
  expect(wouldCycle(db, 'Y', 'X')).toBe(true); // Y→X would close X→Y
  expect(addDep(db, 'Y', 'X', NOW)).toMatchObject({ ok: false, code: 409 }); // cycle
});

test('addDep detects a transitive cycle', () => {
  for (const id of ['A', 'B', 'C']) insertTask(db, mk(id));
  addDep(db, 'A', 'B', NOW); // A depends on B
  addDep(db, 'B', 'C', NOW); // B depends on C
  expect(addDep(db, 'C', 'A', NOW)).toMatchObject({ ok: false, code: 409 }); // C→A closes the loop
});

test('addDep 404s when a task is missing', () => {
  insertTask(db, mk('X'));
  expect(addDep(db, 'X', 'ghost', NOW)).toMatchObject({ ok: false, code: 404 });
  expect(addDep(db, 'ghost', 'X', NOW)).toMatchObject({ ok: false, code: 404 });
});

test('dueTasks silences a blocked task and reactivates it when the prerequisite is done', () => {
  insertTask(db, mk('X'));
  insertTask(db, mk('Y'));
  addDep(db, 'X', 'Y', NOW);
  const now = '2030-01-01T00:00:00+02:00'; // both remind_at are in the past relative to this
  expect(dueTasks(db, now).map(t => t.id).sort()).toEqual(['Y']); // X silenced
  updateTask(db, 'Y', { status: 'done' });
  expect(dueTasks(db, now).map(t => t.id)).toEqual(['X']); // X back in play
});

test('removeDep clears the blocker', () => {
  insertTask(db, mk('X'));
  insertTask(db, mk('Y'));
  addDep(db, 'X', 'Y', NOW);
  removeDep(db, 'X', 'Y');
  expect(openBlockers(db, 'X')).toEqual([]);
});

test('deleting a prerequisite cascades the dependency row', () => {
  insertTask(db, mk('X'));
  insertTask(db, mk('Y'));
  addDep(db, 'X', 'Y', NOW);
  deleteTask(db, 'Y');
  expect(openBlockers(db, 'X')).toEqual([]);
});

test('getTask includes both link directions (blocked_by + blocks)', () => {
  insertTask(db, mk('X'));
  insertTask(db, mk('Y'));
  addDep(db, 'X', 'Y', NOW); // X depends on Y → Y blocks X
  expect(getTask(db, 'X')!.blocked_by!.map(b => b.id)).toEqual(['Y']);
  expect(getTask(db, 'X')!.blocks).toEqual([]);
  expect(getTask(db, 'Y')!.blocked_by).toEqual([]);
  expect(getTask(db, 'Y')!.blocks!.map(b => b.id)).toEqual(['X']);
});

test('listTasks carries blocked_by per task', () => {
  insertTask(db, mk('X'));
  insertTask(db, mk('Y'));
  addDep(db, 'X', 'Y', NOW);
  const feed = listTasks(db);
  const x = feed.find(t => t.id === 'X')!;
  const y = feed.find(t => t.id === 'Y')!;
  expect(x.blocked_by!.map(b => b.id)).toEqual(['Y']);
  expect(y.blocked_by).toEqual([]);
});

test('listTasks carries blocks (open dependents) — the other direction', () => {
  insertTask(db, mk('X'));
  insertTask(db, mk('Y'));
  addDep(db, 'X', 'Y', NOW); // X depends on Y → Y blocks X
  const feed = listTasks(db);
  const x = feed.find(t => t.id === 'X')!;
  const y = feed.find(t => t.id === 'Y')!;
  expect(y.blocks!.map(b => b.id)).toEqual(['X']);
  expect(x.blocks).toEqual([]);
});

test('a closed dependent (done or shelved) drops out of blocks', () => {
  insertTask(db, mk('X'));
  insertTask(db, mk('Z'));
  insertTask(db, mk('Y'));
  addDep(db, 'X', 'Y', NOW); // Y blocks X
  addDep(db, 'Z', 'Y', NOW); // Y blocks Z
  updateTask(db, 'X', { status: 'done' });
  updateTask(db, 'Z', { status: 'shelved' });
  const y = listTasks(db).find(t => t.id === 'Y')!;
  expect(y.blocks).toEqual([]);
});

test('absorbClientTags moves a configured client tag onto the client field', () => {
  upsertClient(db, { key: 'acme', label: 'Acme', sort: 0 });
  expect(absorbClientTags(db, ['onprem', 'Acme'], null)).toEqual({ tags: ['onprem'], client: 'acme' });
  // Already the same client → the tag is just dropped.
  expect(absorbClientTags(db, ['acme', 'x'], 'Acme')).toEqual({ tags: ['x'], client: 'Acme' });
  // A tag naming a different client is kept rather than lost.
  upsertClient(db, { key: 'globex', label: 'Globex', sort: 1 });
  expect(absorbClientTags(db, ['globex'], 'acme')).toEqual({ tags: ['globex'], client: 'acme' });
  // No configured clients → untouched.
  deleteClient(db, 'acme'); deleteClient(db, 'globex');
  expect(absorbClientTags(db, ['acme'], null)).toEqual({ tags: ['acme'], client: null });
});

test('startup migration renames the legacy accantonato status to shelved (idempotent)', () => {
  const path = join(tmpdir(), `agenda-mig-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  try {
    const d1 = openDb(path);
    insertTask(d1, sample());
    d1.run("UPDATE tasks SET status = 'accantonato' WHERE id = 'T1'");
    d1.close();
    const d2 = openDb(path);
    expect(getTask(d2, 'T1')?.status).toBe('shelved');
    d2.close();
    const d3 = openDb(path); // second run is a no-op
    expect(getTask(d3, 'T1')?.status).toBe('shelved');
    d3.close();
  } finally {
    rmSync(path, { force: true });
  }
});
