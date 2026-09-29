// Study-mode helpers for the UI: derive subjects from config, and compute per
// subject the countdown, progress and pace shown in the sidebar and the study
// timeline. Pure functions (mirror of the backend's study.ts) — no stores here.
import type { Task, Category, ConfigBundle, ScopeDef } from './types';

const DAY = 86_400_000;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export type StudySubject = Category & {
  exam_date: string; start_date: string | null; review_days: number | null;
};

// Subjects = subject-kind categories with an exam date, sorted by nearest exam.
export function subjectsOf(c: ConfigBundle): StudySubject[] {
  return c.categories
    .filter((x): x is StudySubject => x.kind === 'subject' && !!x.exam_date)
    .slice()
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date));
}

export function isStudyScope(s: ScopeDef | undefined): boolean {
  return s?.type === 'study';
}

// The topics of a subject: tasks that carry the subject key in `services`.
export function topicsOf(tasks: Task[], key: string): Task[] {
  const k = key.toLowerCase();
  return tasks.filter((t) => (t.services ?? []).some((s) => s.toLowerCase() === k));
}

export function reviewDaysOf(s: StudySubject, c: ConfigBundle): number {
  if (typeof s.review_days === 'number') return Math.max(0, s.review_days);
  const g = Number.parseInt(c.settings['study.review_days'] ?? '', 10);
  return Number.isFinite(g) ? Math.max(0, g) : 3;
}

// Whole days from now to the exam (negative = past).
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.ceil((Date.parse(iso) - now.getTime()) / DAY);
}

export interface Progress { done: number; total: number; pct: number; }
export function progressOf(topics: Task[]): Progress {
  const total = topics.length;
  const done = topics.filter((t) => t.status === 'done').length;
  return { done, total, pct: total ? done / total : 0 };
}

export type PaceStatus = 'none' | 'ahead' | 'on_track' | 'slightly_behind' | 'behind';
export interface Pace extends Progress {
  expectedPct: number;
  plannedDueByNow: number;
  behindBy: number;
  status: PaceStatus;
}

export function paceOf(
  topics: Task[], startIso: string | null, examIso: string, reviewDays: number, now: Date = new Date()
): Pace {
  const nowMs = now.getTime();
  const { done, total, pct } = progressOf(topics);
  const rawStart = startIso ? Date.parse(startIso) : nowMs;
  const end = Date.parse(examIso) - reviewDays * DAY;
  const span = end - rawStart;
  const expectedPct = span > 0 ? clamp01((nowMs - rawStart) / span) : 1;
  const plannedDueByNow = topics.filter((t) => Date.parse(t.due_at) <= nowMs).length;
  const behindBy = Math.max(0, plannedDueByNow - done);

  let status: PaceStatus;
  if (total === 0) status = 'none';
  else if (behindBy >= 2) status = 'behind';
  else if (behindBy === 1) status = 'slightly_behind';
  else if (pct > expectedPct + 0.05) status = 'ahead';
  else status = 'on_track';

  return { done, total, pct, expectedPct, plannedDueByNow, behindBy, status };
}

// A topic's dot state on the per-exam timeline.
export function topicState(t: Task, now: Date = new Date()): 'done' | 'overdue' | 'pending' {
  if (t.status === 'done') return 'done';
  return Date.parse(t.due_at) < now.getTime() ? 'overdue' : 'pending';
}

// Position (0-100%) of a moment within a subject's [start … exam] axis.
export function axisPos(iso: string, startIso: string | null, examIso: string, now: Date = new Date()): number {
  const start = startIso ? Date.parse(startIso) : now.getTime();
  const exam = Date.parse(examIso);
  const span = exam - start;
  if (span <= 0) return 100;
  return clamp01((Date.parse(iso) - start) / span) * 100;
}
