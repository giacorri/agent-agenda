// The single reader for a task's `due_at` (and `remind_at`). Pure, no stores or i18n,
// so every view and its tests share one definition of "when is this due".
//
// `due_at` is '' (no deadline), a date-only `YYYY-MM-DD`, or an ISO datetime.
// `new Date('2026-10-21')` is UTC midnight: 02:00 in Rome, the previous evening west
// of UTC. A date-only due is a local calendar day instead, and it lasts the whole day.

export interface Due {
  /** The due instant; for a date-only due, local midnight of that day. */
  at: Date;
  /** True for a date-only `YYYY-MM-DD` due: "that day", no time of day. */
  allDay: boolean;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDue(due: string | null | undefined): Due | null {
  if (!due) return null;
  const m = DATE_ONLY.exec(due);
  if (m) return { at: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), allDay: true };
  const at = new Date(due);
  return Number.isNaN(at.getTime()) ? null : { at, allDay: false };
}

/** The due instant as a Date (local midnight for a date-only due), or null when unset. */
export const dueDate = (due: string | null | undefined): Date | null => parseDue(due)?.at ?? null;

/** Epoch ms of the due instant, or NaN when unset (comparisons with NaN are false). */
export const dueMs = (due: string | null | undefined): number => parseDue(due)?.at.getTime() ?? NaN;

/** The instant the task turns late: its due time, or the end of a date-only day. */
export function dueDeadline(d: Due): number {
  if (!d.allDay) return d.at.getTime();
  return new Date(d.at.getFullYear(), d.at.getMonth(), d.at.getDate() + 1).getTime();
}

/** True when a due is set and its deadline is already behind `now`. */
export function isPastDue(due: string | null | undefined, now: Date = new Date()): boolean {
  const d = parseDue(due);
  return !!d && dueDeadline(d) <= now.getTime();
}

/**
 * Chronological order of two `due_at` values, '' last. Compares instants, not
 * strings: offsets differ across tasks ("…T21:00+02:00" is before "…T20:00+00:00"),
 * and a date-only day sorts before any timed due on the same day.
 */
export function cmpDueAt(a: string, b: string): number {
  const da = parseDue(a), db = parseDue(b);
  if (!da) return db ? 1 : 0;
  if (!db) return -1;
  return da.at.getTime() - db.at.getTime() || Number(db.allDay) - Number(da.allDay);
}
