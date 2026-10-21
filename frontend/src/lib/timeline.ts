// Day-by-day grouping for the timeline's default view. Pure (no stores, no i18n)
// so it can be unit-tested: callers pass `now` and translate the section keys.
import type { Task } from './types';
import { parseDue, type Due } from './due';

export { parseDue, type Due };

const DAY_MS = 86_400_000;
const dayStart = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const plusDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Whole calendar days between two local midnights (DST-safe via rounding).
const dayDiff = (a: Date, b: Date): number => Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / DAY_MS);

/**
 * overdue  — due on a day before today (one section, oldest first)
 * today / tomorrow — those calendar days (today is always present, even when empty)
 * day      — one of the following days up to `days` ahead, one section each
 * month    — anything further out, one section per calendar month
 */
export type SectionKind = 'overdue' | 'today' | 'tomorrow' | 'day' | 'month';

export interface DayItem {
  task: Task;
  due: Due;
  /** Open and past its due instant (a timed task due earlier today, or anything overdue). */
  late: boolean;
}

export interface DaySection {
  key: string;
  kind: SectionKind;
  /** First day the section covers (local midnight); for `overdue`, the oldest due day. */
  date: Date;
  items: DayItem[];
}

export interface DayGroups {
  sections: DaySection[];
  /** Open tasks with no due date, oldest-added first. */
  undated: Task[];
}

const OPEN = new Set(['pending', 'in_progress', 'snoozed']);

// Most pressing first inside a day: priority (lower = more important), then
// all-day items (they belong to the whole day), then by time, then title.
function cmpItems(a: DayItem, b: DayItem): number {
  return (a.task.priority - b.task.priority)
    || (Number(b.due.allDay) - Number(a.due.allDay))
    || (a.due.at.getTime() - b.due.at.getTime())
    || a.task.title.localeCompare(b.task.title);
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Group open tasks by due day, starting today. Done and shelved tasks are left out.
 * `days` is how many days (today included) get their own section before
 * further work folds into per-month sections.
 */
export function groupByDay(tasks: Task[], now: Date, days = 7): DayGroups {
  const today = dayStart(now);
  const overdue: DayItem[] = [];
  const byKey = new Map<string, DaySection>();
  const undated: Task[] = [];

  for (const task of tasks) {
    if (!OPEN.has(task.status)) continue;
    const due = parseDue(task.due_at);
    if (!due) { undated.push(task); continue; }
    const offset = dayDiff(today, due.at);
    const late = due.allDay ? offset < 0 : due.at.getTime() < now.getTime();
    const item: DayItem = { task, due, late };
    if (offset < 0) { overdue.push(item); continue; }

    let kind: SectionKind, key: string, date: Date;
    if (offset < days) {
      date = plusDays(today, offset);
      kind = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : 'day';
      key = ymd(date);
    } else {
      date = new Date(due.at.getFullYear(), due.at.getMonth(), 1);
      kind = 'month';
      key = `m-${ymd(date)}`;
    }
    let sec = byKey.get(key);
    if (!sec) byKey.set(key, (sec = { key, kind, date, items: [] }));
    sec.items.push(item);
  }

  if (!byKey.has(ymd(today))) byKey.set(ymd(today), { key: ymd(today), kind: 'today', date: today, items: [] });

  // Month sections start on the 1st, which may precede the per-day sections (the
  // rest of the current month), so they always sort after them.
  const isMonth = (s: DaySection) => (s.kind === 'month' ? 1 : 0);
  const sections = [...byKey.values()].sort((a, b) => isMonth(a) - isMonth(b) || a.date.getTime() - b.date.getTime());
  for (const s of sections) s.items.sort(cmpItems);

  if (overdue.length) {
    // Oldest slip first: the longer it has waited, the more pressing it is.
    overdue.sort((a, b) => a.due.at.getTime() - b.due.at.getTime() || a.task.priority - b.task.priority);
    sections.unshift({ key: 'overdue', kind: 'overdue', date: dayStart(overdue[0].due.at), items: overdue });
  }

  undated.sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
  return { sections, undated };
}

/** Whole days a due day lies before `now`'s day (0 = today, positive = past). */
export const daysLate = (due: Due, now: Date): number => dayDiff(due.at, now);
