// Layout math for the timeline's Gantt mode. Pure (no stores, no i18n, no DOM) so
// it can be unit-tested: callers pass `now`, render the returned geometry in pixels
// and translate the labels. Rows and their grouping come from groupByDay, so the
// Gantt and the By day list always agree on which section a task sits in.
import type { Task } from './types';
import { parseDue, dueDeadline, type Due } from './due';

const DAY_MS = 86_400_000;

export type Zoom = 'day' | 'week' | 'month' | 'quarter';
export const ZOOMS: readonly Zoom[] = ['day', 'week', 'month', 'quarter'];

/**
 * Per zoom: pixels per day, how many days before today the view opens on (so a
 * slipped task stays in sight, today near the left edge), and the minimum span
 * ahead of today the axis always reaches.
 */
export const ZOOM_SPEC: Record<Zoom, { px: number; lead: number; ahead: number }> = {
  day: { px: 46, lead: 3, ahead: 28 },
  week: { px: 16, lead: 7, ahead: 84 },
  month: { px: 5.5, lead: 14, ahead: 183 },
  quarter: { px: 2, lead: 30, ahead: 365 },
};

// How far the axis may stretch for a stray far-off date, so one task due in
// two years cannot make the canvas thousands of screens wide.
const MAX_BACK = 366;
const MAX_AHEAD = 731;

export const dayStart = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const plusDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Whole calendar days from `a`'s day to `b`'s day (DST-safe). */
export const dayDiff = (a: Date, b: Date): number => Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / DAY_MS);

/**
 * Position of an instant on the axis, in days from `start` (a local midnight).
 * The fraction is the share of that local calendar day already gone, so on a
 * 23- or 25-hour DST day a time still lands inside its own day column.
 */
export function dayPos(start: Date, d: Date): number {
  const day = dayStart(d);
  const len = plusDays(day, 1).getTime() - day.getTime();
  return dayDiff(start, day) + (d.getTime() - day.getTime()) / len;
}

export interface Range {
  /** Local midnight of the first day on the axis. */
  start: Date;
  /** Number of day columns. */
  days: number;
  /** Day column of today. */
  today: number;
}

/**
 * The axis span: from `lead` days before today (or the oldest overdue due, within
 * a year) to at least `ahead` days after today, stretched to the furthest due shown
 * (within two years) plus a margin so its label fits.
 */
export function ganttRange(dues: Date[], now: Date, zoom: Zoom): Range {
  const { lead, ahead } = ZOOM_SPEC[zoom];
  const today = dayStart(now);
  let back = lead;
  let fwd = ahead;
  for (const d of dues) {
    const off = dayDiff(today, d);
    if (off < 0) back = Math.max(back, Math.min(-off + 2, MAX_BACK));
    else fwd = Math.max(fwd, Math.min(off + Math.ceil(ahead / 4), MAX_AHEAD));
  }
  return { start: plusDays(today, -back), days: back + fwd + 1, today: back };
}

/** Day column the view should scroll to on open and on "Today". */
export const initialScrollDay = (r: Range, zoom: Zoom): number => Math.max(0, r.today - ZOOM_SPEC[zoom].lead);

export type MarkKind = 'open' | 'progress' | 'snoozed' | 'late' | 'done' | 'shelved';

export interface Mark {
  kind: MarkKind;
  /** All-day due: a block filling the due day. Timed due: a diamond at the instant. */
  shape: 'day' | 'point';
  /** Start of the block, or centre of the diamond, in days from range start. */
  at: number;
  /** Block width in days (1 for a day block, 0 for a point). */
  span: number;
  /** Faint lead-in from creation to the due, in days; null when it would be empty. */
  leadFrom: number | null;
  /** For a late task, the overdue stretch from the deadline up to now, in days. */
  late: { from: number; to: number } | null;
}

function kindOf(t: Task, late: boolean): MarkKind {
  if (t.status === 'done') return 'done';
  if (t.status === 'shelved') return 'shelved';
  if (late) return 'late';
  if (t.status === 'in_progress') return 'progress';
  if (t.status === 'snoozed') return 'snoozed';
  return 'open';
}

/**
 * Where a task sits on the axis. The due is the anchor; creation is only a faint
 * lead-in (how long it has been waiting), clipped to the range start. A closed task
 * is drawn on the day it was completed, falling back to its due.
 */
export function markFor(t: Task, due: Due, range: Range, now: Date): Mark {
  const closed = t.status === 'done' || t.status === 'shelved';
  let anchor: Due = due;
  if (closed && t.completed_at) {
    const c = new Date(t.completed_at);
    if (!Number.isNaN(c.getTime())) anchor = { at: c, allDay: false };
  }
  const late = !closed && dueDeadline(due) <= now.getTime();
  const shape: Mark['shape'] = anchor.allDay ? 'day' : 'point';
  const at = anchor.allDay ? dayDiff(range.start, anchor.at) : dayPos(range.start, anchor.at);

  let leadFrom: number | null = null;
  const created = new Date(t.created_at);
  if (!closed && !Number.isNaN(created.getTime())) {
    const from = Math.max(0, dayPos(range.start, created));
    if (at - from > 0.5) leadFrom = from;
  }

  let lateSpan: Mark['late'] = null;
  if (late) {
    const from = anchor.allDay ? at + 1 : at;
    const to = dayPos(range.start, now);
    if (to > from) lateSpan = { from, to };
  }
  return { kind: kindOf(t, late), shape, at, span: shape === 'day' ? 1 : 0, leadFrom, late: lateSpan };
}

export interface Tier {
  /** First day of the cell (local midnight), for the label. */
  date: Date;
  /** Cell start and width, in days from range start (clipped to the range). */
  from: number;
  span: number;
}

export interface DayCell { from: number; date: Date; weekend: boolean; today: boolean; }

export interface Axis {
  /** Upper header row: months, or years at quarter zoom. */
  top: Tier[];
  /** Lower header row: days, weeks (Monday start), or months at quarter zoom. */
  bottom: Tier[];
  /** What a bottom cell is, so the caller picks its label format. */
  unit: 'day' | 'week' | 'month';
  /** Vertical grid lines, in days from range start. */
  lines: number[];
}

function cells(range: Range, next: (d: Date) => Date, first: Date): Tier[] {
  const out: Tier[] = [];
  for (let d = first; dayDiff(range.start, d) < range.days; d = next(d)) {
    const from = Math.max(0, dayDiff(range.start, d));
    const to = Math.min(range.days, dayDiff(range.start, next(d)));
    if (to > from) out.push({ date: d, from, span: to - from });
  }
  return out;
}

const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const nextMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 1);
const weekStart = (d: Date) => plusDays(d, -((d.getDay() + 6) % 7)); // Monday

/** Two-tier header: a coarse row on top, a fine row below, never sharing a line. */
export function axisFor(range: Range, zoom: Zoom): Axis {
  const months = cells(range, nextMonth, monthStart(range.start));
  if (zoom === 'quarter') {
    const years = cells(range, (d) => new Date(d.getFullYear() + 1, 0, 1), new Date(range.start.getFullYear(), 0, 1));
    return { top: years, bottom: months, unit: 'month', lines: months.map((c) => c.from) };
  }
  if (zoom === 'day') {
    const days = cells(range, (d) => plusDays(d, 1), range.start);
    return { top: months, bottom: days, unit: 'day', lines: days.map((c) => c.from) };
  }
  const weeks = cells(range, (d) => plusDays(d, 7), weekStart(range.start));
  return { top: months, bottom: weeks, unit: 'week', lines: weeks.map((c) => c.from) };
}

/** Every day column with its weekend/today flags, for shading the background. */
export function dayCells(range: Range): DayCell[] {
  return Array.from({ length: range.days }, (_, i) => {
    const date = plusDays(range.start, i);
    const wd = date.getDay();
    return { from: i, date, weekend: wd === 0 || wd === 6, today: i === range.today };
  });
}

/**
 * Closed tasks for the optional "Done" group: completed (or, failing that, due)
 * inside the range, most recent first. Shelved tasks count as closed.
 */
export function closedRows(tasks: Task[], range: Range): { task: Task; due: Due }[] {
  const end = plusDays(range.start, range.days).getTime();
  const out: { task: Task; due: Due; t: number }[] = [];
  for (const task of tasks) {
    if (task.status !== 'done' && task.status !== 'shelved') continue;
    const due = parseDue(task.due_at);
    const doneAt = task.completed_at ? new Date(task.completed_at) : null;
    const when = doneAt && !Number.isNaN(doneAt.getTime()) ? doneAt : due?.at;
    if (!when || when.getTime() < range.start.getTime() || when.getTime() >= end) continue;
    out.push({ task, due: due ?? { at: when, allDay: false }, t: when.getTime() });
  }
  return out.sort((a, b) => b.t - a.t).map(({ task, due }) => ({ task, due }));
}
