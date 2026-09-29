import type { Task } from './types';
import { getLocale } from './i18n';

// The work/personal "hidden scope" concept now lives in stores/scope.ts
// (isHidden), driven by the configurable scopes — see issue #7.

export const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

// Compact, locale-aware "how long ago" label for note timestamps. Intl.RelativeTimeFormat
// handles the wording per language ("3h ago" / "3 h fa", "yesterday" / "ieri").
export function relativeTime(iso: string, now: Date = new Date(), loc: string = getLocale()): string {
  const past = (new Date(iso).getTime() - now.getTime()) / 1000; // negative = in the past
  const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto', style: 'narrow' });
  const min = Math.round(past / 60);
  if (Math.abs(min) < 1) return rtf.format(0, 'second'); // "now" / "ora"
  if (Math.abs(min) < 60) return rtf.format(min, 'minute');
  const h = Math.round(min / 60);
  if (Math.abs(h) < 24) return rtf.format(h, 'hour');
  const d = Math.round(h / 24);
  if (Math.abs(d) < 7) return rtf.format(d, 'day'); // "yesterday" / "ieri" via numeric:auto
  const w = Math.round(d / 7);
  if (Math.abs(w) < 5) return rtf.format(w, 'week');
  return rtf.format(Math.round(d / 30), 'month');
}

// A task counts as "open" while it isn't done. Used everywhere we list/count active work.
export const isOpen = (t: Task): boolean =>
  t.status === 'pending' || t.status === 'in_progress' || t.status === 'snoozed';

// Terminal states that leave the active agenda: completed or shelved. Grouped together
// under the "Closed" section, coloured per status.
export const isClosed = (t: Task): boolean =>
  t.status === 'done' || t.status === 'shelved';

// A task has a real deadline when due_at is set. An empty due_at means a "general"
// backlog item: no reminders, grouped separately, sorted by insertion date.
export const hasDue = (t: Task): boolean => !!t.due_at;

// Sort helper that keeps no-deadline tasks after dated ones (their '' would sort first).
export const cmpDue = (a: Task, b: Task): number => {
  if (!a.due_at) return b.due_at ? 1 : 0;
  if (!b.due_at) return -1;
  return a.due_at.localeCompare(b.due_at);
};

// General tasks are ordered by when they were added (oldest first).
export const cmpInserted = (a: Task, b: Task): number => a.created_at.localeCompare(b.created_at);

// "Missed" is computed, not a stored status: an open task whose due time is already past.
export const isOverdue = (t: Task): boolean =>
  hasDue(t) && isOpen(t) && new Date(t.due_at).getTime() < Date.now();

// Stable, language-neutral grouping keys; translate to display labels only at
// render (see bucketLabel in $lib/format). Order is chronological top-to-bottom:
// the oldest overdue work sits above today, so a glance reads past → present →
// future. 'done' is the terminal bucket.
export const BUCKET_ORDER = [
  'earlier', 'last_week', 'earlier_this_week', 'yesterday',
  'today', 'tomorrow', 'this_week', 'later', 'general', 'done',
] as const;

// The past (overdue) buckets, in the same order. Used to flag late sections in
// the UI so they read differently from upcoming work.
export const OVERDUE_BUCKETS: ReadonlySet<string> =
  new Set(['earlier', 'last_week', 'earlier_this_week', 'yesterday']);
export const isOverdueBucket = (key: string): boolean => OVERDUE_BUCKETS.has(key);

export function bucket(t: Task, now: Date = new Date()): string {
  if (!hasDue(t)) return 'general'; // no deadline → the General backlog group
  const due = new Date(t.due_at);
  // Same-day work stays under "today"/"tomorrow" even if the clock time is past.
  if (sameDay(due, now)) return 'today';
  if (sameDay(due, addDays(now, 1))) return 'tomorrow';

  const today0 = startOfDay(now);
  const due0 = startOfDay(due);
  if (due0 < today0) {
    // Overdue: graduate by how many whole days back, so far-gone work surfaces
    // separately from something that slipped yesterday.
    const days = Math.round((today0.getTime() - due0.getTime()) / 86_400_000);
    if (days === 1) return 'yesterday';
    if (days <= 7) return 'earlier_this_week';
    if (days <= 14) return 'last_week';
    return 'earlier';
  }
  return due < addDays(now, 7) ? 'this_week' : 'later';
}

// Visual category for a task's timeline bar / card accent.
export type BarKind = 'done' | 'overdue' | 'snoozed' | 'active';
export function barKind(t: Task): BarKind {
  if (isClosed(t)) return 'done';  // shelved reads as ended too (green cap)
  if (isOverdue(t)) return 'overdue';
  if (t.status === 'snoozed') return 'snoozed';
  return 'active';
}

// Where a task's bar ends on the time axis: completion for done tasks, else the due date.
export const barEndDate = (t: Task): Date =>
  new Date(t.status === 'done' && t.completed_at ? t.completed_at : t.due_at);
