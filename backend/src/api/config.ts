import type { Database } from 'bun:sqlite';
import type { Category, Person, Client, RefMapping, ScopeDef, WsMessage } from '../types';
import {
  listCategories, getCategory, upsertCategory, deleteCategory,
  listPeople, getPerson, upsertPerson, deletePerson,
  listClients, getClient, upsertClient, deleteClient,
  listRefs, getRef, upsertRef, deleteRef,
  listScopes, getScope, upsertScope, deleteScope,
  getSettings, patchSettings, reminderDefaults,
  configBundle, configStatus, bootstrap,
} from '../config-db';
import { listTasks, updateTask, getTask } from '../db';
import { distributeDueDates } from '../study';

const DAY = 86_400_000;
// A date-only ISO string (YYYY-MM-DD), `days` from today — for seeded example exams.
const dateFromNow = (days: number): string => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

type Broadcast = (m: WsMessage) => void;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Per-entity wiring so the four CRUD endpoints share one code path. `id` is the
// primary-key field name (key, or shorthand for refs); `coerce` fills defaults +
// validates a posted body into a full row.
interface Entity<T> {
  list: (db: Database) => T[];
  get: (db: Database, id: string) => T | null;
  upsert: (db: Database, row: T) => void;
  del: (db: Database, id: string) => void;
  idField: keyof T & string;
  coerce: (body: Record<string, unknown>, existing?: T) => T | { error: string };
}

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : v == null ? fallback : String(v);
const int = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
// Nullable helpers for optional subject fields: keep an explicit null, fall back
// to the existing value when the key is absent from the patch body.
const dateOrNull = (v: unknown, fallback: string | null): string | null =>
  v === null ? null : typeof v === 'string' && v.trim() ? v : fallback;
const intOrNull = (v: unknown, fallback: number | null): number | null =>
  v === null ? null : typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;

const categories: Entity<Category> = {
  list: listCategories, get: getCategory, upsert: upsertCategory, del: deleteCategory,
  idField: 'key',
  coerce(b, ex) {
    const key = str(b.key, ex?.key ?? '');
    if (!key) return { error: 'key required' };
    const kind = b.kind === 'app' ? 'app' : b.kind === 'subject' ? 'subject'
      : b.kind === 'service' ? 'service' : ex?.kind ?? 'service';
    return {
      key,
      label: str(b.label, ex?.label ?? key),
      icon: str(b.icon, ex?.icon ?? 'dot'),
      color: str(b.color, ex?.color ?? '#8896a8'),
      kind,
      sort: int(b.sort, ex?.sort ?? 0),
      exam_date: 'exam_date' in b ? dateOrNull(b.exam_date, ex?.exam_date ?? null) : ex?.exam_date ?? null,
      start_date: 'start_date' in b ? dateOrNull(b.start_date, ex?.start_date ?? null) : ex?.start_date ?? null,
      review_days: 'review_days' in b ? intOrNull(b.review_days, ex?.review_days ?? null) : ex?.review_days ?? null,
    };
  },
};

const people: Entity<Person> = {
  list: listPeople, get: getPerson, upsert: upsertPerson, del: deletePerson,
  idField: 'key',
  coerce(b, ex) {
    const key = str(b.key, ex?.key ?? '');
    if (!key) return { error: 'key required' };
    return {
      key,
      label: str(b.label, ex?.label ?? key),
      role: str(b.role, ex?.role ?? ''),
      sort: int(b.sort, ex?.sort ?? 0),
      photo: str(b.photo, ex?.photo ?? ''),
    };
  },
};

const clients: Entity<Client> = {
  list: listClients, get: getClient, upsert: upsertClient, del: deleteClient,
  idField: 'key',
  coerce(b, ex) {
    const key = str(b.key, ex?.key ?? '');
    if (!key) return { error: 'key required' };
    return {
      key,
      label: str(b.label, ex?.label ?? key),
      sort: int(b.sort, ex?.sort ?? 0),
      logo: str(b.logo, ex?.logo ?? ''),
    };
  },
};

const refs: Entity<RefMapping> = {
  list: listRefs, get: getRef, upsert: upsertRef, del: deleteRef,
  idField: 'shorthand',
  coerce(b, ex) {
    const shorthand = str(b.shorthand, ex?.shorthand ?? '');
    if (!shorthand) return { error: 'shorthand required' };
    const owner_repo = str(b.owner_repo, ex?.owner_repo ?? '');
    if (!owner_repo) return { error: 'owner_repo required' };
    return { shorthand, owner_repo, host: str(b.host, ex?.host ?? 'github.com') };
  },
};

const scopes: Entity<ScopeDef> = {
  list: listScopes, get: getScope, upsert: upsertScope, del: deleteScope,
  idField: 'key',
  coerce(b, ex) {
    const key = str(b.key, ex?.key ?? '');
    if (!key) return { error: 'key required' };
    return {
      key,
      label: str(b.label, ex?.label ?? key),
      tag: str(b.tag, ex?.tag ?? ''),
      sort: int(b.sort, ex?.sort ?? 0),
      icon: str(b.icon, ex?.icon ?? ''),
      type: b.type === 'study' ? 'study' : b.type === 'generic' ? 'generic' : ex?.type ?? 'generic',
    };
  },
};

const ENTITIES: Record<string, Entity<any>> = { categories, people, clients, refs, scopes };

export async function handleConfigRequest(
  req: Request, url: URL, db: Database, broadcast: Broadcast
): Promise<Response> {
  const method = req.method;
  // strip the /api/config prefix → ['', 'categories', 'web#1'] etc.
  const rest = url.pathname.replace(/^\/api\/config/, '').replace(/^\//, '');
  const parts = rest ? rest.split('/') : [];

  // GET /api/config → full bundle
  if (method === 'GET' && parts.length === 0) return json(configBundle(db));

  // GET /api/config/status
  if (method === 'GET' && parts[0] === 'status' && parts.length === 1) {
    return json(configStatus(db));
  }

  // POST /api/config/bootstrap — apply a whole config doc (idempotent)
  if (method === 'POST' && parts[0] === 'bootstrap' && parts.length === 1) {
    const doc = await req.json().catch(() => ({}));
    bootstrap(db, doc);
    broadcast({ type: 'config.updated' });
    return json(configBundle(db), 200);
  }

  // POST /api/config/preset/student — seed a study scope + two example subjects
  // (dates relative to now). Idempotent: upserts by key.
  if (method === 'POST' && parts[0] === 'preset' && parts[1] === 'student' && parts.length === 2) {
    bootstrap(db, {
      scopes: [{ key: 'study', label: 'Study', tag: 'study', sort: 0, icon: 'book', type: 'study' }],
      categories: [
        { key: 'calculus-1', label: 'Calculus I', icon: 'chart', color: '#5b9bd5', kind: 'subject', sort: 0, exam_date: dateFromNow(21), start_date: dateFromNow(0), review_days: 3 },
        { key: 'physics-2', label: 'Physics II', icon: 'spark', color: '#e0a458', kind: 'subject', sort: 1, exam_date: dateFromNow(35), start_date: dateFromNow(0), review_days: 3 },
      ],
      settings: { 'study.review_days': '3' },
    });
    broadcast({ type: 'config.updated' });
    return json(configBundle(db), 201);
  }

  // POST /api/config/subjects/:key/distribute — spread the subject's remaining
  // (not-done) topics evenly from now to exam - review, preserving insertion order.
  if (method === 'POST' && parts[0] === 'subjects' && parts[2] === 'distribute' && parts.length === 3) {
    const key = decodeURIComponent(parts[1]);
    const subj = getCategory(db, key);
    if (!subj || subj.kind !== 'subject' || !subj.exam_date) {
      return json({ error: 'not a subject with an exam date' }, 400);
    }
    const settings = getSettings(db);
    const review = typeof subj.review_days === 'number'
      ? subj.review_days
      : Math.max(0, Number.parseInt(settings['study.review_days'] ?? '3', 10) || 0);
    const nowIso = new Date().toISOString();
    const pending = listTasks(db, { service: key })
      .filter((t) => t.status !== 'done')
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const def = reminderDefaults(db);
    const dues = distributeDueDates(
      pending.length, subj.start_date ?? nowIso, subj.exam_date, review, nowIso,
      { hour: def.hour, minute: def.minute },
    );
    pending.forEach((t, i) => {
      updateTask(db, t.id, { due_at: dues[i], remind_at: dues[i] });
      const updated = getTask(db, t.id);
      if (updated) broadcast({ type: 'task.updated', task: updated });
    });
    return json({ updated: pending.length });
  }

  // GET /api/config/settings  ·  PATCH /api/config/settings
  if (parts[0] === 'settings' && parts.length === 1) {
    if (method === 'GET') return json(getSettings(db));
    if (method === 'PATCH') {
      const patch = await req.json().catch(() => ({}));
      if (patch == null || typeof patch !== 'object') return json({ error: 'object body required' }, 400);
      patchSettings(db, patch as Record<string, unknown>);
      broadcast({ type: 'config.updated' });
      return json(getSettings(db));
    }
    return json({ error: 'method not allowed' }, 405);
  }

  // Entity CRUD: /api/config/{categories|people|refs|scopes}[/:id]
  const entity = ENTITIES[parts[0] ?? ''];
  if (entity) {
    const id = parts[1] ? decodeURIComponent(parts[1]) : undefined;

    if (method === 'GET' && !id) return json(entity.list(db));

    if (method === 'POST' && !id) {
      const body = await req.json().catch(() => ({}));
      const row = entity.coerce(body ?? {});
      if ('error' in row) return json(row, 400);
      entity.upsert(db, row);
      broadcast({ type: 'config.updated' });
      return json(row, 201);
    }

    if (method === 'PATCH' && id) {
      const existing = entity.get(db, id);
      if (!existing) return json({ error: 'not found' }, 404);
      const body = await req.json().catch(() => ({}));
      // PATCH never moves the primary key: pin it to the URL id.
      const row = entity.coerce({ ...(body ?? {}), [entity.idField]: id }, existing);
      if ('error' in row) return json(row, 400);
      entity.upsert(db, row);
      broadcast({ type: 'config.updated' });
      return json(row);
    }

    if (method === 'DELETE' && id) {
      entity.del(db, id);
      broadcast({ type: 'config.updated' });
      return new Response(null, { status: 204 });
    }
  }

  return json({ error: 'not found' }, 404);
}
