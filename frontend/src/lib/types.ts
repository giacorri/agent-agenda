// 'missed' is NOT a stored status — being overdue is computed from due_at (see isOverdue).
// 'shelved' is terminal like 'done' but not a completion: keeps the task,
// stays out of the active agenda, reachable only from the status control.
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'snoozed' | 'shelved';
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

// Last-note preview surfaced on list cards (see listTasks on the backend).
export interface NoteMeta {
  body: string;
  kind: NoteKind;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  summary: string | null;
  due_at: string; // '' = no deadline (general task): see hasDue() in $lib/time
  remind_at: string; // '' when there's no deadline — never fires a reminder
  status: TaskStatus;
  priority: number;
  services: string[];
  tags: string[];
  source: TaskSource;
  // Who asked for this task. null = self-assigned (the user's own idea).
  requester: string | null;
  // The client/company the task is for (work only). null = none. Free text; a
  // configured client (substring match on its key) drives the sidebar row + page.
  client: string | null;
  // Closing handoff message for the requester, shown as the Closing section. Markdown.
  closing: string | null;
  agent_session: string | null;
  agent_cwd: string | null;
  created_at: string;
  completed_at: string | null;
  notified_at: string | null;
  // Forward plan: ordered "next steps". Notes are the backward-looking timeline.
  steps: string[];
  // Present only in the list feed; the latest note doubles as the at-a-glance status.
  note_count?: number;
  last_note?: NoteMeta | null;
  // Prerequisites still open (not done or shelved); empty/absent = not blocked. `blocked` is derived.
  blocked_by?: DepRef[];
  // Still-open tasks that depend on this one (the ones it blocks). On the list feed
  // and single GET; drives the card's relations popover and the drawer's "blocks" list.
  blocks?: DepRef[];
}

export interface TaskWithNotes extends Task {
  notes: Note[];
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

// ---- Configuration (mirrors the backend config store) ---------------------
// A work service, a personal app, or a study subject. `kind` splits them into
// sidebar sections. A `subject` is an exam: it carries a study window and a
// review buffer; its topics are ordinary tasks tagged with its key.
export interface Category {
  key: string;
  label: string;
  icon: string;
  color: string;
  kind: 'service' | 'app' | 'subject';
  sort: number;
  exam_date?: string | null;    // ISO date of the exam (subject only).
  start_date?: string | null;   // ISO date the study window opens (subject only).
  review_days?: number | null;  // days reserved for review before the exam (subject only).
}

// A known requester. `key` is the canonical match token (substring, case-insensitive).
export interface Person {
  key: string;
  label: string;
  role: string;
  sort: number;
  // Optional avatar: a path/URL or a data: URL. Empty/absent = neutral user glyph.
  photo?: string;
}

// A client/company a task is done for. Same matching rule as Person: `key` is the
// canonical token, matched case-insensitively as a substring of the task's `client`.
export interface Client {
  key: string;
  label: string;
  sort: number;
  // Optional logo: a path/URL or a data: URL. Empty/absent = neutral building glyph.
  logo?: string;
}

// shorthand → owner/repo on a git host, for auto-linking refs like "web#498".
export interface RefMapping {
  shorthand: string;
  owner_repo: string;
  host: string;
}

// A work/personal-style scope; `tag` marks membership (empty = default scope).
export interface ScopeDef {
  key: string;
  label: string;
  tag: string;
  sort: number;
  // Optional per-scope glyph. A path/URL ("/x.png", "http…") renders as an image;
  // any other value is treated as an Icon-set name. Empty/absent = no icon.
  icon?: string;
  // 'study' turns the scope into exam mode (subjects, countdowns, per-exam
  // timeline and pace). Default 'generic'.
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
