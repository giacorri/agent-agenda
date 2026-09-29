import type { Database } from 'bun:sqlite';
import type {
  Category, Person, Client, RefMapping, ScopeDef, ConfigBundle, ConfigStatus,
} from './types';

// Config tables are created here and wired into openDb(). They ship EMPTY: no
// seeded defaults — a fresh DB has zero categories/people/refs/scopes/settings,
// which is what /api/config/status reports as first-run.
const CONFIG_SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  key   TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon  TEXT NOT NULL DEFAULT 'dot',
  color TEXT NOT NULL DEFAULT '#8896a8',
  kind  TEXT NOT NULL DEFAULT 'service',
  sort  INTEGER NOT NULL DEFAULT 0,
  exam_date   TEXT,
  start_date  TEXT,
  review_days INTEGER
);
CREATE TABLE IF NOT EXISTS people (
  key   TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  role  TEXT NOT NULL DEFAULT '',
  sort  INTEGER NOT NULL DEFAULT 0,
  photo TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS clients (
  key   TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0,
  logo  TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ref_mappings (
  shorthand  TEXT PRIMARY KEY,
  owner_repo TEXT NOT NULL,
  host       TEXT NOT NULL DEFAULT 'github.com'
);
CREATE TABLE IF NOT EXISTS scopes (
  key   TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  tag   TEXT NOT NULL DEFAULT '',
  sort  INTEGER NOT NULL DEFAULT 0,
  icon  TEXT NOT NULL DEFAULT '',
  type  TEXT NOT NULL DEFAULT 'generic'
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Idempotent: only adds the config tables, never touches tasks/notes.
export function ensureConfigTables(db: Database): void {
  db.exec(CONFIG_SCHEMA);
  // Migrations for DBs created before a column existed (CREATE TABLE IF NOT
  // EXISTS won't add columns to an existing table).
  addColumn(db, 'scopes', 'icon', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'scopes', 'type', "TEXT NOT NULL DEFAULT 'generic'");
  addColumn(db, 'categories', 'exam_date', 'TEXT');
  addColumn(db, 'categories', 'start_date', 'TEXT');
  addColumn(db, 'categories', 'review_days', 'INTEGER');
  addColumn(db, 'people', 'photo', "TEXT NOT NULL DEFAULT ''");
}

// Add a column only if it isn't already present (idempotent ALTER).
function addColumn(db: Database, table: string, col: string, def: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

// ---- categories -----------------------------------------------------------
const CAT_COLS = 'key,label,icon,color,kind,sort,exam_date,start_date,review_days';
export function listCategories(db: Database): Category[] {
  return db.query(
    `SELECT ${CAT_COLS} FROM categories ORDER BY sort ASC, key ASC`
  ).all() as Category[];
}
export function getCategory(db: Database, key: string): Category | null {
  return (db.query(`SELECT ${CAT_COLS} FROM categories WHERE key = ?`)
    .get(key) as Category | undefined) ?? null;
}
export function upsertCategory(db: Database, c: Category): void {
  const kind = c.kind === 'app' ? 'app' : c.kind === 'subject' ? 'subject' : 'service';
  db.run(
    `INSERT INTO categories (key,label,icon,color,kind,sort,exam_date,start_date,review_days)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET
       label=excluded.label, icon=excluded.icon, color=excluded.color,
       kind=excluded.kind, sort=excluded.sort,
       exam_date=excluded.exam_date, start_date=excluded.start_date, review_days=excluded.review_days`,
    [c.key, c.label, c.icon ?? 'dot', c.color ?? '#8896a8', kind, c.sort ?? 0,
     c.exam_date ?? null, c.start_date ?? null, c.review_days ?? null]
  );
}
export function deleteCategory(db: Database, key: string): void {
  db.run('DELETE FROM categories WHERE key = ?', [key]);
}

// ---- people ---------------------------------------------------------------
export function listPeople(db: Database): Person[] {
  return db.query(
    'SELECT key,label,role,sort,photo FROM people ORDER BY sort ASC, key ASC'
  ).all() as Person[];
}
export function getPerson(db: Database, key: string): Person | null {
  return (db.query('SELECT key,label,role,sort,photo FROM people WHERE key = ?')
    .get(key) as Person | undefined) ?? null;
}
export function upsertPerson(db: Database, p: Person): void {
  db.run(
    `INSERT INTO people (key,label,role,sort,photo) VALUES (?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET label=excluded.label, role=excluded.role, sort=excluded.sort, photo=excluded.photo`,
    [p.key, p.label, p.role ?? '', p.sort ?? 0, p.photo ?? '']
  );
}
export function deletePerson(db: Database, key: string): void {
  db.run('DELETE FROM people WHERE key = ?', [key]);
}

// ---- clients --------------------------------------------------------------
export function listClients(db: Database): Client[] {
  return db.query(
    'SELECT key,label,sort,logo FROM clients ORDER BY sort ASC, key ASC'
  ).all() as Client[];
}
export function getClient(db: Database, key: string): Client | null {
  return (db.query('SELECT key,label,sort,logo FROM clients WHERE key = ?')
    .get(key) as Client | undefined) ?? null;
}
export function upsertClient(db: Database, c: Client): void {
  db.run(
    `INSERT INTO clients (key,label,sort,logo) VALUES (?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET label=excluded.label, sort=excluded.sort, logo=excluded.logo`,
    [c.key, c.label, c.sort ?? 0, c.logo ?? '']
  );
}
export function deleteClient(db: Database, key: string): void {
  db.run('DELETE FROM clients WHERE key = ?', [key]);
}

// ---- ref mappings ---------------------------------------------------------
export function listRefs(db: Database): RefMapping[] {
  return db.query(
    'SELECT shorthand,owner_repo,host FROM ref_mappings ORDER BY shorthand ASC'
  ).all() as RefMapping[];
}
export function getRef(db: Database, shorthand: string): RefMapping | null {
  return (db.query('SELECT shorthand,owner_repo,host FROM ref_mappings WHERE shorthand = ?')
    .get(shorthand) as RefMapping | undefined) ?? null;
}
export function upsertRef(db: Database, r: RefMapping): void {
  db.run(
    `INSERT INTO ref_mappings (shorthand,owner_repo,host) VALUES (?,?,?)
     ON CONFLICT(shorthand) DO UPDATE SET owner_repo=excluded.owner_repo, host=excluded.host`,
    [r.shorthand, r.owner_repo, r.host ?? 'github.com']
  );
}
export function deleteRef(db: Database, shorthand: string): void {
  db.run('DELETE FROM ref_mappings WHERE shorthand = ?', [shorthand]);
}

// ---- scopes ---------------------------------------------------------------
export function listScopes(db: Database): ScopeDef[] {
  return db.query(
    'SELECT key,label,tag,sort,icon,type FROM scopes ORDER BY sort ASC, key ASC'
  ).all() as ScopeDef[];
}
export function getScope(db: Database, key: string): ScopeDef | null {
  return (db.query('SELECT key,label,tag,sort,icon,type FROM scopes WHERE key = ?')
    .get(key) as ScopeDef | undefined) ?? null;
}
export function upsertScope(db: Database, s: ScopeDef): void {
  db.run(
    `INSERT INTO scopes (key,label,tag,sort,icon,type) VALUES (?,?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET label=excluded.label, tag=excluded.tag, sort=excluded.sort,
       icon=excluded.icon, type=excluded.type`,
    [s.key, s.label, s.tag ?? '', s.sort ?? 0, s.icon ?? '', s.type === 'study' ? 'study' : 'generic']
  );
}
export function deleteScope(db: Database, key: string): void {
  db.run('DELETE FROM scopes WHERE key = ?', [key]);
}

// Server-driven reminder defaults, read from settings with safe fallbacks.
// default_remind_time = "HH:MM" (fallback 09:30); default_remind_before_min =
// minutes before due to fire the reminder (fallback 0 = at due time).
export interface ReminderDefaults { hour: number; minute: number; remindBeforeMin: number; }
export function reminderDefaults(db: Database): ReminderDefaults {
  const s = getSettings(db);
  const [hRaw, mRaw] = (s.default_remind_time ?? '09:30').split(':');
  const hour = clampInt(hRaw, 9, 0, 23);
  const minute = clampInt(mRaw, 30, 0, 59);
  const remindBeforeMin = Math.max(0, Number.parseInt(s.default_remind_before_min ?? '0', 10) || 0);
  return { hour, minute, remindBeforeMin };
}
function clampInt(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// The tag of the first configured "hidden" (personal-like) scope, if any.
// Used to keep the personal toggle / personal-ingest in sync with config.
export function hiddenScopeTag(db: Database): string | null {
  const row = db.query(
    "SELECT tag FROM scopes WHERE tag <> '' ORDER BY sort ASC, key ASC LIMIT 1"
  ).get() as { tag: string } | undefined;
  return row?.tag ?? null;
}

// ---- settings (key/value) -------------------------------------------------
export function getSettings(db: Database): Record<string, string> {
  const rows = db.query('SELECT key,value FROM settings').all() as Array<{ key: string; value: string }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
export function patchSettings(db: Database, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    db.run(
      `INSERT INTO settings (key,value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [k, String(v)]
    );
  }
}

// ---- bundle / status / bootstrap ------------------------------------------
export function configBundle(db: Database): ConfigBundle {
  return {
    categories: listCategories(db),
    people: listPeople(db),
    clients: listClients(db),
    refs: listRefs(db),
    scopes: listScopes(db),
    settings: getSettings(db),
  };
}

// table names are internal constants, never user input → safe to interpolate.
function count(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

export function configStatus(db: Database): ConfigStatus {
  const counts = {
    categories: count(db, 'categories'),
    people: count(db, 'people'),
    clients: count(db, 'clients'),
    refs: count(db, 'ref_mappings'),
    scopes: count(db, 'scopes'),
    settings: count(db, 'settings'),
  };
  const total = counts.categories + counts.people + counts.clients + counts.refs
    + counts.scopes + counts.settings;
  return { configured: total > 0, counts };
}

// Apply a whole config doc in one shot. Idempotent: every entity upserts by key,
// so re-applying the same doc is a no-op. Partial docs are fine (omit a section).
export function bootstrap(db: Database, doc: Partial<ConfigBundle>): void {
  if (doc.categories) for (const c of doc.categories) upsertCategory(db, c);
  if (doc.people) for (const p of doc.people) upsertPerson(db, p);
  if (doc.clients) for (const c of doc.clients) upsertClient(db, c);
  if (doc.refs) for (const r of doc.refs) upsertRef(db, r);
  if (doc.scopes) for (const s of doc.scopes) upsertScope(db, s);
  if (doc.settings) patchSettings(db, doc.settings);
}
