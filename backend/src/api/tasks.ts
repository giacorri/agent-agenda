import type { Database } from 'bun:sqlite';
import { newId } from '../ids';
import { insertTask, listTasks, getTask, updateTask, deleteTask, insertNote, listNotes, getNote, updateNote, deleteNote, addDep, removeDep, dependents, absorbClientTags } from '../db';
import { reminderDefaults } from '../config-db';
import type { Task, TaskStatus, WsMessage, Note, AddNotePayload, TaskWithNotes } from '../types';
import { normalizeStatus } from '../types';

type Broadcast = (m: WsMessage) => void;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function nowIso(): string { return new Date().toISOString(); }

// A task's status changed → its dependents' `blocked_by` (and thus their blocked
// state) may have flipped. Re-broadcast each so open clients update badges live.
function propagateToDependents(db: Database, id: string, broadcast: Broadcast): void {
  for (const dep of dependents(db, id)) {
    const updated = getTask(db, dep.id);
    if (updated) broadcast({ type: 'task.updated', task: updated });
  }
}

// Parse a JSON body without throwing on malformed input (returns null → 400).
async function readJson(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { return null; }
}

const VALID_STATUS = new Set<TaskStatus>(['pending', 'in_progress', 'done', 'snoozed', 'shelved']);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

// Whitelist + type-check the fields a client may PATCH, so bad values (an invalid
// status, a non-array `tags` that would corrupt later JSON.parse reads) are rejected
// with a 400 instead of being stored.
function coercePatch(raw: unknown): { patch: Partial<Task> } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'object body required' };
  const r = raw as Record<string, unknown>;
  const patch: Partial<Task> = {};
  if ('title' in r) { if (typeof r.title !== 'string' || !r.title.trim()) return { error: 'title must be a non-empty string' }; patch.title = r.title; }
  if ('summary' in r) { if (r.summary !== null && typeof r.summary !== 'string') return { error: 'summary must be string or null' }; patch.summary = r.summary as string | null; }
  // '' clears the deadline (general task); anything else must be a valid ISO date.
  if ('due_at' in r) { if (r.due_at !== '' && !isIso(r.due_at)) return { error: 'due_at must be an ISO date or ""' }; patch.due_at = r.due_at as string; }
  if ('remind_at' in r) { if (r.remind_at !== '' && !isIso(r.remind_at)) return { error: 'remind_at must be an ISO date or ""' }; patch.remind_at = r.remind_at as string; }
  if ('status' in r) { r.status = normalizeStatus(r.status); if (!VALID_STATUS.has(r.status as TaskStatus)) return { error: 'invalid status' }; patch.status = r.status as TaskStatus; }
  if ('priority' in r) { if (typeof r.priority !== 'number' || !Number.isFinite(r.priority)) return { error: 'priority must be a number' }; patch.priority = r.priority; }
  if ('tags' in r) { if (!isStrArray(r.tags)) return { error: 'tags must be a string array' }; patch.tags = r.tags; }
  if ('services' in r) { if (!isStrArray(r.services)) return { error: 'services must be a string array' }; patch.services = r.services; }
  if ('steps' in r) { if (!isStrArray(r.steps)) return { error: 'steps must be a string array' }; patch.steps = r.steps; }
  if ('requester' in r) { if (r.requester !== null && typeof r.requester !== 'string') return { error: 'requester must be string or null' }; patch.requester = r.requester as string | null; }
  if ('client' in r) { if (r.client !== null && typeof r.client !== 'string') return { error: 'client must be string or null' }; patch.client = r.client as string | null; }
  if ('closing' in r) { if (r.closing !== null && typeof r.closing !== 'string') return { error: 'closing must be string or null' }; patch.closing = r.closing as string | null; }
  if ('completed_at' in r) { if (r.completed_at !== null && typeof r.completed_at !== 'string') return { error: 'completed_at must be string or null' }; patch.completed_at = r.completed_at as string | null; }
  return { patch };
}

function snoozeIso(until: string, base: Date, def: { hour: number; minute: number }): string {
  if (until === '10m') return new Date(base.getTime() + 10 * 60_000).toISOString();
  if (until === '1h') return new Date(base.getTime() + 60 * 60_000).toISOString();
  if (until === 'tomorrow') {
    const d = new Date(base); d.setDate(d.getDate() + 1); d.setHours(def.hour, def.minute, 0, 0);
    return d.toISOString();
  }
  if (until === '1w') {
    const d = new Date(base); d.setDate(d.getDate() + 7); d.setHours(def.hour, def.minute, 0, 0);
    return d.toISOString();
  }
  return until; // arbitrary ISO / custom preset passed straight through
}

export async function handleTasksRequest(
  req: Request, url: URL, db: Database, broadcast: Broadcast
): Promise<Response> {
  const method = req.method;
  const path = url.pathname;

  if (method === 'GET' && path === '/api/tasks') {
    const status = normalizeStatus(url.searchParams.get('status')) as TaskStatus | 'all' | null;
    const from = url.searchParams.get('from') ?? undefined;
    const to = url.searchParams.get('to') ?? undefined;
    const tag = url.searchParams.get('tag') ?? undefined;
    const service = url.searchParams.get('service') ?? undefined;
    return json(listTasks(db, { status: status ?? undefined, from, to, tag, service }));
  }

  if (method === 'POST' && path === '/api/tasks') {
    const body = await readJson(req) as Partial<Task> | null;
    if (!body || typeof body !== 'object') return json({ error: 'object body required' }, 400);
    if (!body.title) return json({ error: 'title required' }, 400);
    // due_at optional: a task without one is a general (no-deadline) item.
    const dueAt = body.due_at ?? '';
    const norm = absorbClientTags(db, body.tags ?? [], body.client ?? null);
    const t: Task = {
      id: newId(),
      title: body.title,
      summary: body.summary ?? null,
      due_at: dueAt,
      remind_at: body.remind_at ?? dueAt,
      status: 'pending',
      priority: body.priority ?? 2,
      services: body.services ?? [],
      tags: norm.tags,
      source: body.source ?? 'user',
      requester: body.requester ?? null,
      client: norm.client,
      closing: body.closing ?? null,
      agent_session: body.agent_session ?? null,
      agent_cwd: body.agent_cwd ?? null,
      created_at: nowIso(),
      completed_at: null,
      notified_at: null,
      steps: body.steps ?? [],
    };
    insertTask(db, t);
    broadcast({ type: 'task.created', task: t });
    return json(t, 201);
  }

  const idMatch = path.match(/^\/api\/tasks\/([^/]+)(\/.*)?$/);
  if (!idMatch) return json({ error: 'not found' }, 404);
  const id = idMatch[1];
  const sub = idMatch[2];
  const current = getTask(db, id);
  if (!current) return json({ error: 'task not found' }, 404);

  if (method === 'GET' && !sub) {
    const notes = listNotes(db, id);
    // current already carries blocked_by + blocks (open dependents) from getTask.
    const withNotes: TaskWithNotes = { ...current, notes };
    return json(withNotes);
  }

  if (method === 'PATCH' && !sub) {
    const result = coercePatch(await readJson(req));
    if ('error' in result) return json(result, 400);
    updateTask(db, id, result.patch);
    const updated = getTask(db, id)!;
    broadcast({ type: 'task.updated', task: updated });
    if ('status' in result.patch) propagateToDependents(db, id, broadcast);
    return json(updated);
  }

  if (method === 'POST' && sub === '/done') {
    updateTask(db, id, { status: 'done', completed_at: nowIso() });
    const updated = getTask(db, id)!;
    broadcast({ type: 'task.updated', task: updated });
    propagateToDependents(db, id, broadcast);
    return json(updated);
  }

  if (method === 'POST' && sub === '/snooze') {
    const body = await readJson(req) as { until?: unknown } | null;
    const until = body?.until;
    // until must be a known preset or a valid ISO date — never store a bogus string.
    if (typeof until !== 'string' || (!['10m', '1h', 'tomorrow', '1w'].includes(until) && !isIso(until))) {
      return json({ error: 'until must be one of 10m|1h|tomorrow|1w or an ISO date' }, 400);
    }
    const def = reminderDefaults(db);
    // Snoozing a general (no-deadline) task schedules relative to now, not ''.
    const base = current.due_at ? new Date(current.due_at) : new Date();
    const newDue = snoozeIso(until, base, def);
    updateTask(db, id, { status: 'pending', due_at: newDue, remind_at: newDue, notified_at: null });
    const updated = getTask(db, id)!;
    broadcast({ type: 'task.updated', task: updated });
    propagateToDependents(db, id, broadcast);
    return json(updated);
  }

  if (method === 'POST' && sub === '/deps') {
    const body = await readJson(req) as { depends_on?: unknown } | null;
    if (!body || typeof body.depends_on !== 'string' || !body.depends_on) {
      return json({ error: 'depends_on required' }, 400);
    }
    const result = addDep(db, id, body.depends_on, nowIso());
    if (!result.ok) return json({ error: result.error }, result.code);
    const updated = getTask(db, id)!;
    broadcast({ type: 'task.updated', task: updated });
    return json(updated);
  }

  const depMatch = sub?.match(/^\/deps\/([^/]+)$/);
  if (method === 'DELETE' && depMatch) {
    removeDep(db, id, depMatch[1]);
    const updated = getTask(db, id)!;
    broadcast({ type: 'task.updated', task: updated });
    return new Response(null, { status: 204 });
  }

  if (method === 'GET' && sub === '/notes') {
    return json(listNotes(db, id));
  }

  if (method === 'POST' && sub === '/notes') {
    const body = await readJson(req) as AddNotePayload | null;
    if (!body || typeof body.body !== 'string' || !body.body) {
      return json({ error: 'body required' }, 400);
    }
    const n: Note = {
      id: newId(),
      task_id: id,
      body: body.body,
      kind: body.kind ?? 'text',
      created_at: nowIso(),
      agent_session: body.agent_session ?? null,
    };
    insertNote(db, n);
    broadcast({ type: 'note.added', task_id: id, note: n });
    return json(n, 201);
  }

  // Single-note edit / delete: /api/tasks/:id/notes/:noteId
  const noteMatch = sub?.match(/^\/notes\/([^/]+)$/);
  if (noteMatch) {
    const noteId = noteMatch[1];
    const note = getNote(db, noteId);
    if (!note || note.task_id !== id) return json({ error: 'note not found' }, 404);

    if (method === 'PATCH') {
      const patch = await readJson(req) as { body?: string } | null;
      if (!patch || typeof patch.body !== 'string' || !patch.body) return json({ error: 'body required' }, 400);
      updateNote(db, noteId, patch.body);
      const updated = getNote(db, noteId)!;
      broadcast({ type: 'note.updated', task_id: id, note: updated });
      return json(updated);
    }
    if (method === 'DELETE') {
      deleteNote(db, noteId);
      broadcast({ type: 'note.deleted', task_id: id, note_id: noteId });
      return new Response(null, { status: 204 });
    }
  }

  if (method === 'DELETE' && !sub) {
    deleteTask(db, id);
    broadcast({ type: 'task.deleted', id });
    return new Response(null, { status: 204 });
  }

  return json({ error: 'method not allowed' }, 405);
}
