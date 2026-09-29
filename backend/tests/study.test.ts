import { test, expect } from 'bun:test';
import { distributeDueDates, subjectProgress, subjectPace, studyWindow } from '../src/study';
import type { Task } from '../src/types';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
// minimal Task stub — only status + due_at matter to the study helpers
const topic = (status: Task['status'], due: string): Task =>
  ({ status, due_at: due } as Task);

const NOW = Date.parse('2026-07-01T08:00:00.000Z');
const now = iso(NOW);
const exam = iso(NOW + 30 * DAY);      // exam in 30 days
const start = iso(NOW);

test('distributeDueDates spaces topics evenly and reserves the review buffer', () => {
  const dues = distributeDueDates(5, start, exam, 3, now).map(Date.parse);
  expect(dues).toHaveLength(5);
  // strictly increasing
  for (let i = 1; i < dues.length; i++) expect(dues[i]).toBeGreaterThan(dues[i - 1]);
  // last topic lands on/around exam - review (3 days before exam), never after
  const end = Date.parse(exam) - 3 * DAY;
  expect(dues[4]).toBeLessThanOrEqual(end + DAY);
  expect(dues[4]).toBeLessThan(Date.parse(exam));
  // even gaps: consecutive deltas within ~1 day of each other
  const gaps = dues.slice(1).map((d, i) => d - dues[i]);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  expect(spread).toBeLessThan(2 * DAY);
});

test('distributeDueDates with a single topic lands it at the review boundary', () => {
  const [d] = distributeDueDates(1, start, exam, 5, now);
  const end = Date.parse(exam) - 5 * DAY;
  expect(Math.abs(Date.parse(d) - end)).toBeLessThan(DAY);
});

test('distributeDueDates collapses when the exam is too close (end <= start)', () => {
  const soon = iso(NOW + DAY);                 // exam tomorrow
  const dues = distributeDueDates(3, start, soon, 5, now).map(Date.parse);
  // window collapses onto start; all dues clamp to the same day, never past the exam
  for (const d of dues) expect(d).toBeLessThanOrEqual(Date.parse(soon));
});

test('studyWindow never schedules before now even if start_date is in the past', () => {
  const past = iso(NOW - 10 * DAY);
  const w = studyWindow(past, exam, 3, now);
  expect(w.start).toBe(NOW);
});

test('subjectProgress counts done over total', () => {
  const p = subjectProgress([topic('done', now), topic('pending', now), topic('done', now)]);
  expect(p).toEqual({ done: 2, total: 3, pct: 2 / 3 });
});

test('subjectPace flags behind when planned-due topics are still open', () => {
  // 3 topics already due (planned), only 1 done → 2 behind
  const due = iso(NOW - DAY);
  const p = subjectPace(
    [topic('done', due), topic('pending', due), topic('pending', due), topic('pending', iso(NOW + 5 * DAY))],
    start, exam, 3, now
  );
  expect(p.plannedDueByNow).toBe(3);
  expect(p.behindBy).toBe(2);
  expect(p.status).toBe('behind');
});

test('subjectPace is on_track when done keeps up with planned deadlines', () => {
  const p = subjectPace(
    [topic('done', iso(NOW - DAY)), topic('pending', iso(NOW + 5 * DAY))],
    start, exam, 3, now
  );
  expect(p.behindBy).toBe(0);
  expect(['on_track', 'ahead']).toContain(p.status);
});

test('subjectPace reports none for an empty subject', () => {
  expect(subjectPace([], start, exam, 3, now).status).toBe('none');
});
