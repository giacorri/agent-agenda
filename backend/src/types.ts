// 'missed' is NOT a stored status — being overdue is computed from due_at vs now.
// 'shelved' is terminal like 'done' but not a completion: it keeps the task + notes,
// stays out of the active agenda, and is only reachable via the status control.
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'snoozed' | 'shelved';

// Deprecated input spellings, mapped to the canonical status. 'accantonato' was the
// original (Italian) name of 'shelved'; stored rows are migrated on startup (db.ts).
const STATUS_ALIASES: Record<string, TaskStatus> = { accantonato: 'shelved' };
export function normalizeStatus(s: unknown): unknown {
  return typeof s === 'string' && s in STATUS_ALIASES ? STATUS_ALIASES[s] : s;
}
export type TaskSource = 'agent' | 'user';
export type NoteKind = 'text' | 'file' | 'link';

// prerequisite/dependent reference surfaced on a task (blocking links).
export interface DepRef {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface Note {
  id: string;
  task_id: string;
  body: string;
  kind: NoteKind;
  created_at: string;
  agent_session: string | null;
}

// Lightweight last-note preview surfaced on list cards so progress is readable
// at a glance without opening the task drawer.
export interface NoteMeta {
  body: string;
  kind: NoteKind;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  summary: string | null;
  due_at: string;
  remind_at: string;
  status: TaskStatus;
  priority: number;
  services: string[];
  tags: string[];
  source: TaskSource;
  // Who asked for this task. null = self-assigned (the user's own idea). Free text;
  // a configured person (see the config store) drives the closing-message register.
  requester: string | null;
  // The client/company the task is for (work only). null = no client. Free text;
  // a configured client (see config) drives the sidebar row and the /client page.
  client: string | null;
  // The closing handoff message for the requester, written when the work concludes. Markdown.
  // Saved by the handoff-recap skill; shown as the Closing section in the drawer.
  closing: string | null;
  agent_session: string | null;
  agent_cwd: string | null;
  created_at: string;
  completed_at: string | null;
  notified_at: string | null;
  // Forward plan: ordered, short "next steps". Distinct from notes (the backward-looking
  // timeline of what got done). A completed step is removed and turned into a note.
  steps: string[];
  // Populated only by listTasks (the at-a-glance feed); absent on single GET / WS payloads.
  note_count?: number;
  last_note?: NoteMeta | null;
  // Prerequisites not yet `done`. Present on the list feed and single GET;
  // empty/absent = not blocked. `blocked` is derived, not a status.
  blocked_by?: DepRef[];
  // Still-open tasks that depend on this one (the ones it blocks). Populated by
  // listTasks (feed) for the card's relations popover, and by the single GET (drawer).
  blocks?: DepRef[];
}

export interface TaskWithNotes extends Task {
  notes: Note[];
}

export interface IngestPayload {
  title: string;
  // Optional: omitted/empty ⇒ a "general" task with no deadline (due_at = ''),
  // which never fires reminders and sorts into the General group by insertion date.
  when?: string;
  summary?: string;
  body?: string;
  steps?: string[];
  services?: string[];
  tags?: string[];
  priority?: number;
  requester?: string;
  client?: string;
  closing?: string;
  agent_session?: string;
  agent_cwd?: string;
  remind_before_min?: number;
  // When true, mark the task as belonging to the configured hidden scope
  // (resolved server-side; falls back to the 'personal' tag). Preferred over
  // passing the literal tag, which can diverge from a custom hidden-scope tag.
  personal?: boolean;
  // Optional blocking links by keyword. `blocks`: the matched task waits on THIS
  // new task (new task is its prerequisite). `blocked_by`: this new task waits on
  // the matched task. Unmatched keyword → link skipped, task still created.
  blocks?: string;
  blocked_by?: string;
}

export interface StepsIngestPayload {
  match: string;
  steps: string[];
}

export interface ClosingIngestPayload {
  match: string;
  closing: string;
}

export interface PersonalIngestPayload {
  match: string;
  personal: boolean;
}

// Link two existing tasks by keyword: `blocked` depends on `blocked_by` (parent).
export interface LinkIngestPayload {
  blocked: string;
  blocked_by: string;
}

export interface AddNotePayload {
  body: string;
  kind?: NoteKind;
  agent_session?: string;
}

export type WsMessage =
  | { type: 'task.created'; task: Task }
  | { type: 'task.updated'; task: Task }
  | { type: 'task.deleted'; id: string }
  | { type: 'task.due'; task: Task }
  | { type: 'note.added'; task_id: string; note: Note }
  | { type: 'note.updated'; task_id: string; note: Note }
  | { type: 'note.deleted'; task_id: string; note_id: string }
  | { type: 'config.updated' };

// ---- Configuration store --------------------------------------------------
// Everything that used to be hardcoded in the frontend (categories/apps, people,
// ref-link mappings, scopes, app settings) lives in the DB so the app ships empty
// and is set up manually or by an agent. See backend/src/config-db.ts.

// A work service, a personal app, or a study subject. `kind` keeps them apart so
// the UI lists them in separate sidebar sections. A `subject` is an exam: it
// carries a study window (`start_date` … `exam_date`) and a `review_days` buffer
// reserved before the exam; its topics are ordinary tasks tagged with its key.
export interface Category {
  key: string;
  label: string;
  icon: string;
  color: string;
  kind: 'service' | 'app' | 'subject';
  sort: number;
  // Subject-only fields (null/absent for service/app):
  exam_date?: string | null;    // ISO date of the exam — the final deadline wall.
  start_date?: string | null;   // ISO date the study window opens (default: creation day).
  review_days?: number | null;  // days reserved for review before the exam.
}

// A known requester (who asked for the task). `key` is the canonical match token.
export interface Person {
  key: string;
  label: string;
  role: string;
  sort: number;
  // Optional avatar. A path/URL ("/x.png", "http…") or a data: URL renders as an
  // image; empty/absent = the neutral user glyph.
  photo?: string;
}

// A client/company a task is done for. Same matching rule as Person: `key` is the
// canonical token, matched case-insensitively as a substring of the task's `client`.
export interface Client {
  key: string;
  label: string;
  sort: number;
  // Optional logo. A path/URL ("/x.png", "http…") or a data: URL renders as an
  // image; empty/absent = the neutral building glyph.
  logo?: string;
}

// shorthand → owner/repo on a git host, for auto-linking refs like "web#498".
export interface RefMapping {
  shorthand: string;
  owner_repo: string;
  host: string;
}

// A work/personal-style scope. `tag` is the task tag that marks membership;
// an empty tag means the default scope (tasks with no scope tag).
export interface ScopeDef {
  key: string;
  label: string;
  tag: string;
  sort: number;
  // Optional per-scope glyph. A path/URL ("/x.png", "http…") renders as an image;
  // any other value is treated as an Icon-set name. Empty/absent = no icon.
  icon?: string;
  // 'study' turns the scope into exam mode: its categories are subjects with exam
  // dates and the app surfaces countdowns, per-exam timeline and pace. Default 'generic'.
  type?: 'generic' | 'study';
}

export interface ConfigBundle {
  categories: Category[];
  people: Person[];
  clients: Client[];
  refs: RefMapping[];
  scopes: ScopeDef[];
  settings: Record<string, string>;
}

export interface ConfigStatus {
  // false on a fresh install (all config tables empty) → first-run onboarding.
  configured: boolean;
  counts: {
    categories: number;
    people: number;
    clients: number;
    refs: number;
    scopes: number;
    settings: number;
  };
}
