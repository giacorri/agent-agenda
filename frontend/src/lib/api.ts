import type {
  Task, TaskWithNotes, Note, NoteKind,
  Category, Person, Client, RefMapping, ScopeDef, ConfigBundle, ConfigStatus,
} from './types';

const jsonHeaders = { 'Content-Type': 'application/json' };

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4010';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; }
}

async function j<T>(p: Promise<Response> | Response): Promise<T> {
  const res = await p;
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  list: (params: { status?: string; from?: string; to?: string } = {}): Promise<Task[]> => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null) as [string, string][]
    ).toString();
    return j(fetch(`${API}/api/tasks${qs ? `?${qs}` : ''}`));
  },
  create: (input: Partial<Task>): Promise<Task> =>
    j(fetch(`${API}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })),
  done: (id: string): Promise<Task> =>
    j(fetch(`${API}/api/tasks/${id}/done`, { method: 'POST' })),
  snooze: (id: string, until: string): Promise<Task> =>
    j(fetch(`${API}/api/tasks/${id}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ until }),
    })),
  patch: (id: string, patch: Partial<Task>): Promise<Task> =>
    j(fetch(`${API}/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })),
  remove: (id: string): Promise<void> =>
    j(fetch(`${API}/api/tasks/${id}`, { method: 'DELETE' })),
  ingest: (input: { title: string; when?: string; summary?: string; body?: string; tags?: string[]; services?: string[]; requester?: string; client?: string; steps?: string[] }): Promise<Task> =>
    j(fetch(`${API}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })),
  get: (id: string): Promise<TaskWithNotes> =>
    j(fetch(`${API}/api/tasks/${id}`)),
  addNote: (id: string, input: { body: string; kind?: NoteKind }): Promise<Note> =>
    j(fetch(`${API}/api/tasks/${id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })),
  editNote: (id: string, noteId: string, body: string): Promise<Note> =>
    j(fetch(`${API}/api/tasks/${id}/notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })),
  deleteNote: (id: string, noteId: string): Promise<void> =>
    j(fetch(`${API}/api/tasks/${id}/notes/${noteId}`, { method: 'DELETE' })),
  setSteps: (id: string, steps: string[]): Promise<Task> =>
    j(fetch(`${API}/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps }),
    })),
  setClosing: (id: string, closing: string | null): Promise<Task> =>
    j(fetch(`${API}/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ closing }),
    })),
  addDep: (id: string, dependsOn: string): Promise<Task> =>
    j(fetch(`${API}/api/tasks/${id}/deps`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ depends_on: dependsOn }),
    })),
  removeDep: (id: string, depId: string): Promise<void> =>
    j(fetch(`${API}/api/tasks/${id}/deps/${encodeURIComponent(depId)}`, { method: 'DELETE' })),

  // ---- config ----
  getConfig: (): Promise<ConfigBundle> => j(fetch(`${API}/api/config`)),
  getConfigStatus: (): Promise<ConfigStatus> => j(fetch(`${API}/api/config/status`)),
  bootstrapConfig: (doc: Partial<ConfigBundle>): Promise<ConfigBundle> =>
    j(fetch(`${API}/api/config/bootstrap`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(doc) })),
  presetStudent: (): Promise<ConfigBundle> =>
    j(fetch(`${API}/api/config/preset/student`, { method: 'POST', headers: jsonHeaders })),
  distributeSubject: (key: string): Promise<{ updated: number }> =>
    j(fetch(`${API}/api/config/subjects/${encodeURIComponent(key)}/distribute`, { method: 'POST', headers: jsonHeaders })),

  saveCategory: (c: Category): Promise<Category> =>
    j(fetch(`${API}/api/config/categories`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(c) })),
  deleteCategory: (key: string): Promise<void> =>
    j(fetch(`${API}/api/config/categories/${encodeURIComponent(key)}`, { method: 'DELETE' })),

  savePerson: (p: Person): Promise<Person> =>
    j(fetch(`${API}/api/config/people`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(p) })),
  deletePerson: (key: string): Promise<void> =>
    j(fetch(`${API}/api/config/people/${encodeURIComponent(key)}`, { method: 'DELETE' })),

  saveClient: (c: Client): Promise<Client> =>
    j(fetch(`${API}/api/config/clients`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(c) })),
  deleteClient: (key: string): Promise<void> =>
    j(fetch(`${API}/api/config/clients/${encodeURIComponent(key)}`, { method: 'DELETE' })),

  saveRef: (r: RefMapping): Promise<RefMapping> =>
    j(fetch(`${API}/api/config/refs`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(r) })),
  deleteRef: (shorthand: string): Promise<void> =>
    j(fetch(`${API}/api/config/refs/${encodeURIComponent(shorthand)}`, { method: 'DELETE' })),

  saveScope: (s: ScopeDef): Promise<ScopeDef> =>
    j(fetch(`${API}/api/config/scopes`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(s) })),
  deleteScope: (key: string): Promise<void> =>
    j(fetch(`${API}/api/config/scopes/${encodeURIComponent(key)}`, { method: 'DELETE' })),

  patchSettings: (patch: Record<string, string>): Promise<Record<string, string>> =>
    j(fetch(`${API}/api/config/settings`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(patch) })),
};
