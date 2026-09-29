import { Database } from 'bun:sqlite';
import type { Note, NoteKind, NoteMeta, Task, TaskStatus, DepRef } from './types';
import { ensureConfigTables, listClients } from './config-db';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  summary       TEXT,
  due_at        TEXT NOT NULL,
  remind_at     TEXT NOT NULL,
  status        TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 2,
  tags          TEXT NOT NULL DEFAULT '[]',
  services      TEXT NOT NULL DEFAULT '[]',
  source        TEXT NOT NULL,
  requester     TEXT,
  client        TEXT,
  closing       TEXT,
  agent_session TEXT,
  agent_cwd     TEXT,
  created_at    TEXT NOT NULL,
  completed_at  TEXT,
  notified_at   TEXT,
  steps         TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS notes (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'text',
  created_at    TEXT NOT NULL,
  agent_session TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_task ON notes(task_id);

CREATE TABLE IF NOT EXISTS task_deps (
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, -- the blocked (child) task
  depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, -- its prerequisite (parent)
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on)
);
CREATE INDEX IF NOT EXISTS idx_deps_task ON task_deps(task_id);
CREATE INDEX IF NOT EXISTS idx_deps_dep ON task_deps(depends_on);
`;

function migrate(db: Database) {
  // Legacy one-shot: known service names were stored inside `tags` before the
  // `services` column existed. We split them out only for categories that are
  // actually configured — a fresh, empty install ships no defaults, so nothing
  // is hardcoded and the split is a no-op until the user configures categories.
  const KNOWN_SERVICES = new Set(
    (db.query('SELECT key FROM categories').all() as Array<{ key: string }>)
      .map((r) => r.key.toLowerCase())
  );
  const cols = db.query("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  const names = new Set(cols.map(c => c.name));
  if (!names.has('summary')) {
    db.run("ALTER TABLE tasks ADD COLUMN summary TEXT");
  }
  if (!names.has('services')) {
    db.run("ALTER TABLE tasks ADD COLUMN services TEXT NOT NULL DEFAULT '[]'");
  }
  if (!names.has('steps')) {
    db.run("ALTER TABLE tasks ADD COLUMN steps TEXT NOT NULL DEFAULT '[]'");
  }
  if (!names.has('requester')) {
    db.run("ALTER TABLE tasks ADD COLUMN requester TEXT");
  }
  if (!names.has('closing')) {
    db.run("ALTER TABLE tasks ADD COLUMN closing TEXT");
  }
  if (!names.has('client')) {
    db.run("ALTER TABLE tasks ADD COLUMN client TEXT");
  }
  // 'missed' is no longer a status — it's computed from due_at. Reopen any legacy missed rows.
  db.run("UPDATE tasks SET status = 'pending' WHERE status = 'missed'");
  // 'accantonato' was renamed to 'shelved' (idempotent).
  db.run("UPDATE tasks SET status = 'shelved' WHERE status = 'accantonato'");
  if (names.has('description') && !names.has('_description_dropped')) {
    db.run(`INSERT INTO notes (id, task_id, body, kind, created_at, agent_session)
            SELECT 'mig_' || id, id, description, 'text', created_at, NULL
            FROM tasks WHERE description IS NOT NULL AND description <> ''
              AND NOT EXISTS (SELECT 1 FROM notes WHERE task_id = tasks.id AND id LIKE 'mig_%')`);
    db.run("UPDATE tasks SET summary = COALESCE(summary, description) WHERE summary IS NULL");
  }

  // Split known service names out of tags into services column (idempotent).
  const rows = db.query("SELECT id, tags, services FROM tasks").all() as Array<{id:string; tags:string; services:string}>;
  for (const r of rows) {
    let tags: string[]; let services: string[];
    try { tags = JSON.parse(r.tags); } catch { tags = []; }
    try { services = JSON.parse(r.services); } catch { services = []; }
    const newSvc = new Set(services);
    const remainingTags: string[] = [];
    let changed = false;
    for (const t of tags) {
      if (KNOWN_SERVICES.has(t.toLowerCase())) {
        if (!newSvc.has(t.toLowerCase())) { newSvc.add(t.toLowerCase()); changed = true; }
      } else {
        remainingTags.push(t);
      }
    }
    if (changed || remainingTags.length !== tags.length) {
      db.run(`UPDATE tasks SET tags = ?, services = ? WHERE id = ?`,
        [JSON.stringify(remainingTags), JSON.stringify(Array.from(newSvc)), r.id]);
    }
  }

  // Same one-shot for clients: before the `client` column a task was tagged with the
  // client's name. Move those tags onto the column (idempotent, configured clients only).
  const crows = db.query("SELECT id, tags, client FROM tasks").all() as Array<{id:string; tags:string; client:string|null}>;
  for (const r of crows) {
    let tags: string[];
    try { tags = JSON.parse(r.tags); } catch { tags = []; }
    const norm = absorbClientTags(db, tags, r.client);
    if (norm.tags.length !== tags.length || norm.client !== r.client) {
      db.run(`UPDATE tasks SET tags = ?, client = ? WHERE id = ?`,
        [JSON.stringify(norm.tags), norm.client, r.id]);
    }
  }
}

// A tag equal to a configured client key is the legacy way of saying "for client X".
// Drop it from tags and, when the task has no client yet, promote it to `client`. A
// tag naming a *different* client than the one already set is left alone rather than
// silently lost. Used by the startup migration and at create time, so an agent that
// still tags by client name lands on the dedicated field.
export function absorbClientTags(db: Database, tags: string[], client: string | null):
  { tags: string[]; client: string | null } {
  const known = new Set(listClients(db).map((c) => c.key.toLowerCase()));
  if (!known.size) return { tags, client };
  let next = client;
  const kept: string[] = [];
  for (const t of tags) {
    const key = t.trim().toLowerCase();
    if (!known.has(key)) { kept.push(t); continue; }
    if (next === null || next === undefined) next = key;
    else if (next.trim().toLowerCase() !== key) kept.push(t);
  }
  return { tags: kept, client: next ?? null };
}

export function openDb(path: string): Database {
  const db = new Database(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  ensureConfigTables(db); // before migrate(): the tag→service split reads categories
  migrate(db);
  return db;
}

type Row = {
  id: string; title: string; summary: string | null;
  due_at: string; remind_at: string; status: TaskStatus;
  priority: number; tags: string; services: string;
  source: 'agent' | 'user';
  requester: string | null;
  client: string | null;
  closing: string | null;
  agent_session: string | null; agent_cwd: string | null;
  created_at: string; completed_at: string | null; notified_at: string | null;
  steps: string;
};

const rowToTask = (r: Row): Task => ({
  ...r,
  tags: JSON.parse(r.tags),
  services: JSON.parse(r.services ?? '[]'),
  steps: JSON.parse(r.steps ?? '[]'),
});

// Every task SELECT shares this column list so rowToTask always gets `steps`.
const TASK_COLS =
  'id,title,summary,due_at,remind_at,status,priority,tags,services,source,requester,client,closing,agent_session,agent_cwd,created_at,completed_at,notified_at,steps';

export function insertTask(db: Database, t: Task): void {
  db.run(
    `INSERT INTO tasks (id,title,summary,due_at,remind_at,status,priority,tags,services,source,
                        requester,client,closing,agent_session,agent_cwd,created_at,completed_at,notified_at,steps)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [t.id, t.title, t.summary, t.due_at, t.remind_at, t.status, t.priority,
     JSON.stringify(t.tags), JSON.stringify(t.services ?? []),
     t.source, t.requester ?? null, t.client ?? null, t.closing ?? null, t.agent_session, t.agent_cwd,
     t.created_at, t.completed_at, t.notified_at, JSON.stringify(t.steps ?? [])]
  );
}

export function getTask(db: Database, id: string): Task | null {
  const row = db.query(`SELECT ${TASK_COLS} FROM tasks WHERE id = ?`).get(id) as Row | undefined;
  if (!row) return null;
  // Both link directions travel with every single-task read, so WS task.updated
  // broadcasts (which go through getTask) keep the card's relations chip accurate.
  return { ...rowToTask(row), blocked_by: openBlockers(db, id), blocks: openDependents(db, id) };
}

export interface ListFilter {
  status?: TaskStatus | 'all';
  from?: string;
  to?: string;
  tag?: string;
  service?: string;
}

type ListRow = Row & {
  note_count: number;
  last_note_body: string | null;
  last_note_kind: NoteKind | null;
  last_note_at: string | null;
  blocked_by_json: string | null;
  blocks_json: string | null;
};

const parseDeps = (json: string | null): DepRef[] => {
  try { return JSON.parse(json ?? '[]'); } catch { return []; }
};

const rowToListItem = (r: ListRow): Task => {
  const { note_count, last_note_body, last_note_kind, last_note_at, blocked_by_json, blocks_json, ...base } = r;
  const last_note: NoteMeta | null = last_note_at
    ? { body: last_note_body ?? '', kind: last_note_kind ?? 'text', created_at: last_note_at }
    : null;
  return {
    ...rowToTask(base as Row),
    note_count: note_count ?? 0,
    last_note,
    blocked_by: parseDeps(blocked_by_json),
    blocks: parseDeps(blocks_json),
  };
};

export function listTasks(db: Database, f: ListFilter = {}): Task[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.status && f.status !== 'all') { where.push('status = ?'); args.push(f.status); }
  if (f.from) { where.push('due_at >= ?'); args.push(f.from); }
  if (f.to) { where.push('due_at < ?'); args.push(f.to); }
  if (f.tag) { where.push("tags LIKE ?"); args.push(`%"${f.tag}"%`); }
  if (f.service) { where.push("services LIKE ?"); args.push(`%"${f.service}"%`); }
  // Carry per-task note count + latest note so cards show progress without an extra fetch.
  const sql = `SELECT ${TASK_COLS},
                 (SELECT COUNT(*) FROM notes n WHERE n.task_id = tasks.id) AS note_count,
                 (SELECT body       FROM notes n WHERE n.task_id = tasks.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_note_body,
                 (SELECT kind       FROM notes n WHERE n.task_id = tasks.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_note_kind,
                 (SELECT created_at FROM notes n WHERE n.task_id = tasks.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_note_at,
                 (SELECT json_group_array(json_object('id', id, 'title', title, 'status', status))
                    FROM (SELECT p.id AS id, p.title AS title, p.status AS status
                          FROM task_deps d JOIN tasks p ON p.id = d.depends_on
                          WHERE d.task_id = tasks.id AND p.status NOT IN ('done', 'shelved')
                          ORDER BY p.due_at ASC)) AS blocked_by_json,
                 (SELECT json_group_array(json_object('id', id, 'title', title, 'status', status))
                    FROM (SELECT c.id AS id, c.title AS title, c.status AS status
                          FROM task_deps d JOIN tasks c ON c.id = d.task_id
                          WHERE d.depends_on = tasks.id AND c.status NOT IN ('done', 'shelved')
                          ORDER BY c.due_at ASC)) AS blocks_json
               FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY due_at = '' ASC, due_at ASC`; // no-deadline tasks last

  const rows = db.query(sql).all(...args) as ListRow[];
  return rows.map(rowToListItem);
}

const UPDATABLE = new Set([
  'title','summary','due_at','remind_at','status','priority','tags','services',
  'requester','client','closing','completed_at','notified_at','steps'
]);
const JSON_COLS = new Set(['tags','services','steps']);

export function updateTask(db: Database, id: string, patch: Partial<Task>): void {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!UPDATABLE.has(k)) continue;
    sets.push(`${k} = ?`);
    args.push(JSON_COLS.has(k) ? JSON.stringify(v) : v);
  }
  if (!sets.length) return;
  args.push(id);
  db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, args);
}

export function setSteps(db: Database, id: string, steps: string[]): void {
  db.run('UPDATE tasks SET steps = ? WHERE id = ?', [JSON.stringify(steps), id]);
}

export function deleteTask(db: Database, id: string): void {
  db.run('DELETE FROM notes WHERE task_id = ?', [id]);
  db.run('DELETE FROM tasks WHERE id = ?', [id]);
}

// ---- dependencies (blocking links) ----------------------------------------

// Open prerequisites of `taskId`: the tasks it waits on that are not closed (done or shelved).
export function openBlockers(db: Database, taskId: string): DepRef[] {
  return db.query(
    `SELECT p.id, p.title, p.status
     FROM task_deps d JOIN tasks p ON p.id = d.depends_on
     WHERE d.task_id = ? AND p.status NOT IN ('done', 'shelved')
     ORDER BY p.due_at ASC`
  ).all(taskId) as DepRef[];
}

// Tasks that depend on `taskId` (the ones it blocks), regardless of their status.
export function dependents(db: Database, taskId: string): DepRef[] {
  return db.query(
    `SELECT c.id, c.title, c.status
     FROM task_deps d JOIN tasks c ON c.id = d.task_id
     WHERE d.depends_on = ?
     ORDER BY c.due_at ASC`
  ).all(taskId) as DepRef[];
}

// Still-open dependents — the ones this task actually blocks. Closed dependents
// (done/shelved) no longer wait on it, so they drop out (mirrors openBlockers).
export function openDependents(db: Database, taskId: string): DepRef[] {
  return db.query(
    `SELECT c.id, c.title, c.status
     FROM task_deps d JOIN tasks c ON c.id = d.task_id
     WHERE d.depends_on = ? AND c.status NOT IN ('done', 'shelved')
     ORDER BY c.due_at ASC`
  ).all(taskId) as DepRef[];
}

// True if making `childId` depend on `parentId` would close a cycle — i.e. `parentId`
// can already reach `childId` by walking prerequisites upward.
export function wouldCycle(db: Database, childId: string, parentId: string): boolean {
  const row = db.query(
    `WITH RECURSIVE chain(id) AS (
       SELECT depends_on FROM task_deps WHERE task_id = ?
       UNION
       SELECT d.depends_on FROM task_deps d JOIN chain c ON d.task_id = c.id
     )
     SELECT 1 FROM chain WHERE id = ? LIMIT 1`
  ).get(parentId, childId);
  return !!row;
}

type DepResult = { ok: true } | { ok: false; code: number; error: string };

// Add "childId depends on parentId". Guards self-link (400), missing task (404),
// duplicate and cycle (409).
export function addDep(db: Database, childId: string, parentId: string, nowIso: string): DepResult {
  if (childId === parentId) return { ok: false, code: 400, error: 'a task cannot depend on itself' };
  const child = db.query('SELECT 1 FROM tasks WHERE id = ?').get(childId);
  const parent = db.query('SELECT 1 FROM tasks WHERE id = ?').get(parentId);
  if (!child || !parent) return { ok: false, code: 404, error: 'task not found' };
  const exists = db.query('SELECT 1 FROM task_deps WHERE task_id = ? AND depends_on = ?').get(childId, parentId);
  if (exists) return { ok: false, code: 409, error: 'dependency already exists' };
  if (wouldCycle(db, childId, parentId)) return { ok: false, code: 409, error: 'dependency would create a cycle' };
  db.run('INSERT INTO task_deps (task_id, depends_on, created_at) VALUES (?,?,?)', [childId, parentId, nowIso]);
  return { ok: true };
}

export function removeDep(db: Database, childId: string, parentId: string): void {
  db.run('DELETE FROM task_deps WHERE task_id = ? AND depends_on = ?', [childId, parentId]);
}

export function dueTasks(db: Database, nowIso: string): Task[] {
  const rows = db.query(
    `SELECT ${TASK_COLS}
     FROM tasks
     WHERE status = 'pending'
       AND notified_at IS NULL
       AND datetime(remind_at) <= datetime(?)
       AND NOT EXISTS (
         SELECT 1 FROM task_deps d JOIN tasks p ON p.id = d.depends_on
         WHERE d.task_id = tasks.id AND p.status NOT IN ('done', 'shelved')
       )`
  ).all(nowIso) as Row[];
  return rows.map(rowToTask);
}

export function insertNote(db: Database, n: Note): void {
  db.run(
    `INSERT INTO notes (id, task_id, body, kind, created_at, agent_session)
     VALUES (?,?,?,?,?,?)`,
    [n.id, n.task_id, n.body, n.kind, n.created_at, n.agent_session]
  );
}

type NoteRow = {
  id: string; task_id: string; body: string; kind: NoteKind;
  created_at: string; agent_session: string | null;
};

export function listNotes(db: Database, taskId: string): Note[] {
  const rows = db.query(
    `SELECT id, task_id, body, kind, created_at, agent_session
     FROM notes WHERE task_id = ? ORDER BY created_at ASC`
  ).all(taskId) as NoteRow[];
  return rows.map(r => ({ ...r }));
}

export function getNote(db: Database, noteId: string): Note | null {
  const row = db.query(
    `SELECT id, task_id, body, kind, created_at, agent_session FROM notes WHERE id = ?`
  ).get(noteId) as NoteRow | undefined;
  return row ? { ...row } : null;
}

export function updateNote(db: Database, noteId: string, body: string): void {
  db.run('UPDATE notes SET body = ? WHERE id = ?', [body, noteId]);
}

export function deleteNote(db: Database, noteId: string): void {
  db.run('DELETE FROM notes WHERE id = ?', [noteId]);
}

export function findTaskByMatch(db: Database, match: string): Task | null {
  if (match.startsWith('01') && match.length === 26) {
    return getTask(db, match);
  }
  const lower = match.toLowerCase();
  // Match any OPEN task (not just pending) so an agent resuming an in_progress
  // or snoozed task by keyword still finds it; done tasks are excluded.
  const rows = db.query(
    `SELECT ${TASK_COLS}
     FROM tasks
     WHERE status IN ('pending','in_progress','snoozed')
       AND (LOWER(title) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(services) LIKE ?)
     ORDER BY due_at = '' ASC, due_at ASC LIMIT 1`
  ).all(`%${lower}%`, `%"${lower}"%`, `%"${lower}"%`) as Row[];
  return rows[0] ? rowToTask(rows[0]) : null;
}

// Like findTaskByMatch but across ALL statuses — closing messages are usually set on a task
// that is already done, which findTaskByMatch (pending-only) would never find. Prefers the
// most recently created match so a freshly closed task wins.
export function findAnyTaskByMatch(db: Database, match: string): Task | null {
  if (match.startsWith('01') && match.length === 26) {
    return getTask(db, match);
  }
  const lower = match.toLowerCase();
  const rows = db.query(
    `SELECT ${TASK_COLS}
     FROM tasks
     WHERE LOWER(title) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(services) LIKE ? OR LOWER(requester) LIKE ?
     ORDER BY created_at DESC LIMIT 1`
  ).all(`%${lower}%`, `%"${lower}"%`, `%"${lower}"%`, `%${lower}%`) as Row[];
  return rows[0] ? rowToTask(rows[0]) : null;
}
