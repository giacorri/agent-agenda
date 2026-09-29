import type { Database } from 'bun:sqlite';
import { newId } from '../ids';
import { insertTask, insertNote, findTaskByMatch, findAnyTaskByMatch, setSteps, updateTask, getTask, addDep, absorbClientTags } from '../db';
import { hiddenScopeTag, reminderDefaults } from '../config-db';
import { parseWhen } from '../parse/when';
import type { IngestPayload, StepsIngestPayload, ClosingIngestPayload, PersonalIngestPayload, LinkIngestPayload, Task, WsMessage, Note } from '../types';

// Fallback personal tag when no hidden scope is configured (preserves the
// historical work/personal convention on an unconfigured install).
const PERSONAL_TAG = 'personal';

type Broadcast = (m: WsMessage) => void;
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

export async function handleIngestRequest(
  req: Request, db: Database, broadcast: Broadcast
): Promise<Response> {
  let payload: IngestPayload;
  try { payload = await req.json() as IngestPayload; }
  catch { return json({ error: 'invalid JSON' }, 400); }

  if (!payload.title || typeof payload.title !== 'string') {
    return json({ error: 'title required' }, 400);
  }
  const defaults = reminderDefaults(db);
  // `when` is optional. Omitted/blank ⇒ a general task with no deadline: due_at
  // and remind_at stay '' (datetime('') is NULL in SQLite, so it never fires a
  // reminder). A present-but-unparseable `when` is still a 400.
  let dueAt = '';
  let remindAt = '';
  if (payload.when && typeof payload.when === 'string' && payload.when.trim()) {
    const parsed = parseWhen(payload.when, new Date(), { hour: defaults.hour, minute: defaults.minute });
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    dueAt = parsed.iso;
    remindAt = dueAt;
    // Honor the configured default remind-before window when the caller omits one.
    const remindBefore = payload.remind_before_min ?? defaults.remindBeforeMin;
    if (remindBefore > 0) {
      remindAt = new Date(new Date(dueAt).getTime() - remindBefore * 60_000).toISOString();
    }
  }

  // `personal: true` marks the task for the configured hidden scope. Resolve the
  // tag server-side so it tracks a custom hidden-scope tag, not the literal 'personal'.
  // Guard array fields: a non-array tags/services would otherwise throw or corrupt storage.
  let tags = Array.isArray(payload.tags) ? payload.tags.filter((t): t is string => typeof t === 'string') : [];
  if (payload.personal) {
    const personalTag = hiddenScopeTag(db) ?? PERSONAL_TAG;
    if (!tags.some(t => t.toLowerCase() === personalTag.toLowerCase())) {
      tags = [...tags, personalTag];
    }
  }
  const norm = absorbClientTags(db, tags, payload.client?.trim() || null);

  const t: Task = {
    id: newId(),
    title: payload.title,
    summary: payload.summary ?? null,
    due_at: dueAt,
    remind_at: remindAt,
    status: 'pending',
    priority: payload.priority ?? 2,
    services: Array.isArray(payload.services) ? payload.services.filter((s): s is string => typeof s === 'string') : [],
    tags: norm.tags,
    source: 'agent',
    requester: payload.requester?.trim() || null,
    client: norm.client,
    closing: payload.closing?.trim() || null,
    agent_session: payload.agent_session ?? null,
    agent_cwd: payload.agent_cwd ?? null,
    created_at: new Date().toISOString(),
    completed_at: null,
    notified_at: null,
    steps: Array.isArray(payload.steps) ? payload.steps.map(s => String(s).trim()).filter(Boolean) : [],
  };
  insertTask(db, t);
  broadcast({ type: 'task.created', task: t });

  if (payload.body && payload.body.trim()) {
    const note: Note = {
      id: newId(),
      task_id: t.id,
      body: payload.body,
      kind: 'text',
      created_at: new Date().toISOString(),
      agent_session: payload.agent_session ?? null,
    };
    insertNote(db, note);
    broadcast({ type: 'note.added', task_id: t.id, note });
  }

  // Optional blocking links. `blocks`: the matched task waits on THIS new task
  // (new task becomes its prerequisite). `blocked_by`: the new task waits on the
  // matched task. Unmatched keyword → skip the link, still return the task.
  const now = new Date().toISOString();
  if (typeof payload.blocks === 'string' && payload.blocks.trim()) {
    const target = findTaskByMatch(db, payload.blocks);
    if (target && addDep(db, target.id, t.id, now).ok) {
      broadcast({ type: 'task.updated', task: getTask(db, target.id)! });
    }
  }
  if (typeof payload.blocked_by === 'string' && payload.blocked_by.trim()) {
    const prereq = findTaskByMatch(db, payload.blocked_by);
    if (prereq && addDep(db, t.id, prereq.id, now).ok) {
      broadcast({ type: 'task.updated', task: getTask(db, t.id)! });
    }
  }

  return json(t, 201);
}

export async function handleNoteIngestRequest(
  req: Request, db: Database, broadcast: Broadcast
): Promise<Response> {
  type NoteIngest = { match: string; body: string; kind?: 'text' | 'file' | 'link'; agent_session?: string };
  let payload: NoteIngest;
  try { payload = await req.json() as NoteIngest; }
  catch { return json({ error: 'invalid JSON' }, 400); }
  if (!payload.match || !payload.body) return json({ error: 'match and body required' }, 400);

  const task = findTaskByMatch(db, payload.match);
  if (!task) return json({ error: `no pending task matched "${payload.match}"` }, 404);

  const n: Note = {
    id: newId(),
    task_id: task.id,
    body: payload.body,
    kind: payload.kind ?? 'text',
    created_at: new Date().toISOString(),
    agent_session: payload.agent_session ?? null,
  };
  insertNote(db, n);
  broadcast({ type: 'note.added', task_id: task.id, note: n });
  return json({ task_id: task.id, note: n }, 201);
}

// Replace the whole forward plan (next steps) of the task matched by keyword.
export async function handleStepsIngestRequest(
  req: Request, db: Database, broadcast: Broadcast
): Promise<Response> {
  let payload: StepsIngestPayload;
  try { payload = await req.json() as StepsIngestPayload; }
  catch { return json({ error: 'invalid JSON' }, 400); }
  if (!payload.match || !Array.isArray(payload.steps)) {
    return json({ error: 'match and steps[] required' }, 400);
  }

  const task = findTaskByMatch(db, payload.match);
  if (!task) return json({ error: `no pending task matched "${payload.match}"` }, 404);

  const steps = payload.steps.map(s => String(s).trim()).filter(Boolean);
  setSteps(db, task.id, steps);
  const updated = getTask(db, task.id)!;
  broadcast({ type: 'task.updated', task: updated });
  return json({ task_id: task.id, steps }, 200);
}

// Set the closing handoff message of the task matched by keyword (across ALL statuses, since
// a closing message is usually written on a task that is already done).
export async function handleClosingIngestRequest(
  req: Request, db: Database, broadcast: Broadcast
): Promise<Response> {
  let payload: ClosingIngestPayload;
  try { payload = await req.json() as ClosingIngestPayload; }
  catch { return json({ error: 'invalid JSON' }, 400); }
  if (!payload.match || typeof payload.closing !== 'string') {
    return json({ error: 'match and closing required' }, 400);
  }

  const task = findAnyTaskByMatch(db, payload.match);
  if (!task) return json({ error: `no task matched "${payload.match}"` }, 404);

  const closing = payload.closing.trim() || null;
  updateTask(db, task.id, { closing });
  const updated = getTask(db, task.id)!;
  broadcast({ type: 'task.updated', task: updated });
  return json({ task_id: task.id, closing }, 200);
}

// Mark/unmark a task (any status) as personal by toggling the 'personal' tag.
export async function handlePersonalIngestRequest(
  req: Request, db: Database, broadcast: Broadcast
): Promise<Response> {
  let payload: PersonalIngestPayload;
  try { payload = await req.json() as PersonalIngestPayload; }
  catch { return json({ error: 'invalid JSON' }, 400); }
  if (!payload.match || typeof payload.personal !== 'boolean') {
    return json({ error: 'match and personal (boolean) required' }, 400);
  }

  const task = findAnyTaskByMatch(db, payload.match);
  if (!task) return json({ error: `no task matched "${payload.match}"` }, 404);

  // Toggle the configured hidden-scope tag (falls back to 'personal').
  const personalTag = hiddenScopeTag(db) ?? PERSONAL_TAG;
  const others = task.tags.filter(t => t.toLowerCase() !== personalTag.toLowerCase());
  const tags = payload.personal ? [...others, personalTag] : others;
  updateTask(db, task.id, { tags });
  const updated = getTask(db, task.id)!;
  broadcast({ type: 'task.updated', task: updated });
  return json({ task_id: task.id, personal: payload.personal, tags }, 200);
}

// Link two existing tasks by keyword: `blocked` depends on `blocked_by` (parent).
export async function handleLinkIngestRequest(
  req: Request, db: Database, broadcast: Broadcast
): Promise<Response> {
  let payload: LinkIngestPayload;
  try { payload = await req.json() as LinkIngestPayload; }
  catch { return json({ error: 'invalid JSON' }, 400); }
  if (!payload.blocked || !payload.blocked_by) {
    return json({ error: 'blocked and blocked_by required' }, 400);
  }
  const child = findTaskByMatch(db, payload.blocked);
  const parent = findTaskByMatch(db, payload.blocked_by);
  if (!child) return json({ error: `no pending task matched "${payload.blocked}"` }, 404);
  if (!parent) return json({ error: `no pending task matched "${payload.blocked_by}"` }, 404);
  const result = addDep(db, child.id, parent.id, new Date().toISOString());
  if (!result.ok) return json({ error: result.error }, result.code);
  broadcast({ type: 'task.updated', task: getTask(db, child.id)! });
  return json({ blocked: child.id, blocked_by: parent.id }, 201);
}
