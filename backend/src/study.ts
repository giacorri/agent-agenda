// Pure study-mode helpers: no DB, no I/O — just date math over subjects and their
// topic tasks. Used by the seed, the distribute endpoint and mirrored on the
// frontend for the study timeline. Kept side-effect free so it unit-tests cleanly.
import type { Task } from './types';

const DAY = 86_400_000;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export interface TimePref { hour: number; minute: number; }

// The study window for a subject: [start … end], where end = exam - reviewDays.
// `start` never sits in the past (we don't schedule study before "now"). If the
// exam is too close (end <= start) the window collapses onto `start`.
export function studyWindow(
  startIso: string, examIso: string, reviewDays: number, nowIso: string
): { start: number; end: number; exam: number } {
  const now = Date.parse(nowIso);
  const exam = Date.parse(examIso);
  let start = Date.parse(startIso);
  if (!Number.isFinite(start) || start < now) start = now;
  let end = exam - Math.max(0, reviewDays) * DAY;
  if (end <= start) end = start;
  return { start, end, exam };
}

// Spread `count` ordered topics evenly across the study window. Topic i (1-based)
// lands at start + i/count * (end - start), so the last topic falls on `end`
// (= exam - review), leaving [end … exam] free for review. Returns ISO due dates
// set at the given time-of-day.
export function distributeDueDates(
  count: number,
  startIso: string, examIso: string, reviewDays: number, nowIso: string,
  at: TimePref = { hour: 9, minute: 30 },
): string[] {
  const { start, end } = studyWindow(startIso, examIso, reviewDays, nowIso);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const frac = count <= 1 ? 1 : (i + 1) / count;
    const d = new Date(start + frac * (end - start));
    d.setHours(at.hour, at.minute, 0, 0);
    out.push(d.toISOString());
  }
  return out;
}

export interface Progress { done: number; total: number; pct: number; }
export function subjectProgress(topics: Task[]): Progress {
  const total = topics.length;
  const done = topics.filter((t) => t.status === 'done').length;
  return { done, total, pct: total ? done / total : 0 };
}

export type PaceStatus = 'none' | 'ahead' | 'on_track' | 'slightly_behind' | 'behind';
export interface Pace extends Progress {
  progressPct: number;    // done / total (same as pct, named for the bar)
  expectedPct: number;    // fraction of the study window elapsed (the "target" tick)
  plannedDueByNow: number; // topics whose planned due date has already passed
  behindBy: number;       // planned-but-not-done topics
  status: PaceStatus;
}

// Combine time (continuous expectedPct) with planned deadlines (discrete badge):
// behind when you have overdue-by-plan topics still open; ahead when you've done
// more than the elapsed time would ask for.
export function subjectPace(
  topics: Task[], startIso: string, examIso: string, reviewDays: number, nowIso: string
): Pace {
  const now = Date.parse(nowIso);
  const { done, total, pct } = subjectProgress(topics);
  // expectedPct is the fraction of the *real* study window that has elapsed, so a
  // subject started weeks ago reads as "you should be well along" — hence the
  // unclamped start (studyWindow clamps to now, which is only right for scheduling).
  const rawStart = Date.parse(startIso);
  const end = Date.parse(examIso) - Math.max(0, reviewDays) * DAY;
  const span = end - rawStart;
  const expectedPct = span > 0 ? clamp01((now - rawStart) / span) : 1;
  const plannedDueByNow = topics.filter((t) => Date.parse(t.due_at) <= now).length;
  const behindBy = Math.max(0, plannedDueByNow - done);

  let status: PaceStatus;
  if (total === 0) status = 'none';
  else if (behindBy >= 2) status = 'behind';
  else if (behindBy === 1) status = 'slightly_behind';
  else if (pct > expectedPct + 0.05) status = 'ahead';
  else status = 'on_track';

  return { done, total, pct, progressPct: pct, expectedPct, plannedDueByNow, behindBy, status };
}
