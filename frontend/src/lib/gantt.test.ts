// Runs under TZ=Europe/Rome (see package.json).
import { describe, expect, test } from 'bun:test';
import { ganttRange, initialScrollDay, markFor, axisFor, dayCells, dayPos, closedRows, ZOOM_SPEC } from './gantt';
import { parseDue } from './due';
import type { Task } from './types';

const NOW = new Date(2026, 9, 21, 15, 0); // Wed 21 Oct 2026, 15:00 local

let seq = 0;
function task(due_at: string, over: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `t${seq}`, title: `task ${seq}`, summary: null, due_at, remind_at: '', status: 'pending',
    priority: 2, services: [], tags: [], source: 'agent', requester: null, people: [], client: null,
    closing: null, agent_session: null, agent_cwd: null, created_at: '2026-10-01T08:00:00Z',
    completed_at: null, notified_at: null, steps: [], ...over,
  };
}

describe('ganttRange', () => {
  test('opens a few days before today and reaches weeks ahead at day zoom', () => {
    const r = ganttRange([], NOW, 'day');
    expect(r.today).toBe(ZOOM_SPEC.day.lead);
    expect([r.start.getMonth(), r.start.getDate(), r.start.getHours()]).toEqual([9, 18, 0]);
    expect(r.days).toBe(ZOOM_SPEC.day.lead + ZOOM_SPEC.day.ahead + 1);
    expect(initialScrollDay(r, 'day')).toBe(0);
  });

  test('stretches back to the oldest overdue due and forward to the furthest one', () => {
    const r = ganttRange([new Date(2026, 9, 9), new Date(2027, 0, 15)], NOW, 'day');
    expect(r.today).toBe(12 + 2);
    expect(r.start.getDate()).toBe(7);
    const lastDay = new Date(r.start.getFullYear(), r.start.getMonth(), r.start.getDate() + r.days - 1);
    expect(lastDay.getTime()).toBeGreaterThan(new Date(2027, 0, 15).getTime());
    expect(initialScrollDay(r, 'day')).toBe(r.today - ZOOM_SPEC.day.lead);
  });

  test('caps a stray far-off date', () => {
    const r = ganttRange([new Date(2031, 0, 1), new Date(2020, 0, 1)], NOW, 'week');
    expect(r.today).toBe(366);
    expect(r.days - r.today - 1).toBe(731);
  });
});

describe('dayPos', () => {
  test('is the day column plus the share of the local day gone', () => {
    const start = new Date(2026, 9, 18);
    expect(dayPos(start, new Date(2026, 9, 21, 12, 0))).toBeCloseTo(3.5);
  });

  test('stays inside its column on the 25-hour DST day', () => {
    const start = new Date(2026, 9, 24);
    const p = dayPos(start, new Date(2026, 9, 25, 23, 30)); // clocks went back that night
    expect(p).toBeGreaterThan(1.9);
    expect(p).toBeLessThan(2);
  });
});

describe('markFor', () => {
  const range = ganttRange([], NOW, 'day'); // starts Sun 18 Oct

  test('a date-only due fills its whole day', () => {
    const t = task('2026-10-23');
    const m = markFor(t, parseDue(t.due_at)!, range, NOW);
    expect(m).toMatchObject({ kind: 'open', shape: 'day', at: 5, span: 1, late: null });
    expect(m.leadFrom).toBe(0); // created before the range: clipped to its start
  });

  test('a timed due is a point at its instant', () => {
    const t = task('2026-10-22T09:30:00+02:00', { status: 'in_progress', created_at: '2026-10-21T10:00:00+02:00' });
    const m = markFor(t, parseDue(t.due_at)!, range, NOW);
    expect(m.shape).toBe('point');
    expect(m.kind).toBe('progress');
    expect(m.at).toBeCloseTo(4 + 9.5 / 24);
    expect(m.leadFrom).toBeCloseTo(3 + 10 / 24);
  });

  test('an overdue all-day task runs red from the end of its day to now', () => {
    const t = task('2026-10-19');
    const m = markFor(t, parseDue(t.due_at)!, range, NOW);
    expect(m.kind).toBe('late');
    expect(m.late!.from).toBe(2);
    expect(m.late!.to).toBeCloseTo(3 + 15 / 24);
  });

  test('a date-only task due today is not late yet', () => {
    const t = task('2026-10-21');
    expect(markFor(t, parseDue(t.due_at)!, range, NOW).kind).toBe('open');
  });

  test('a timed task due earlier today is late', () => {
    const t = task('2026-10-21T09:00:00+02:00');
    const m = markFor(t, parseDue(t.due_at)!, range, NOW);
    expect(m.kind).toBe('late');
    expect(m.late!.from).toBeCloseTo(3 + 9 / 24);
  });

  test('a done task sits on its completion, without lead-in or lateness', () => {
    const t = task('2026-10-19', { status: 'done', completed_at: '2026-10-20T16:00:00+02:00' });
    const m = markFor(t, parseDue(t.due_at)!, range, NOW);
    expect(m).toMatchObject({ kind: 'done', shape: 'point', leadFrom: null, late: null });
    expect(m.at).toBeCloseTo(2 + 16 / 24);
  });

  test('no lead-in when created the same moment it is due', () => {
    const t = task('2026-10-22T09:00:00+02:00', { created_at: '2026-10-22T08:50:00+02:00' });
    expect(markFor(t, parseDue(t.due_at)!, range, NOW).leadFrom).toBeNull();
  });
});

describe('axisFor', () => {
  test('day zoom: months on top, one cell per day below', () => {
    const r = ganttRange([], NOW, 'day');
    const a = axisFor(r, 'day');
    expect(a.unit).toBe('day');
    expect(a.bottom.length).toBe(r.days);
    expect(a.top.map((c) => c.date.getMonth())).toEqual([9, 10]);
    expect(a.top[0].span).toBe(14); // 18–31 Oct
    expect(a.top[0].from + a.top[0].span).toBe(a.top[1].from);
  });

  test('week zoom: cells start on Monday, the first one clipped to the range', () => {
    const r = ganttRange([], NOW, 'week'); // starts Wed 14 Oct
    const a = axisFor(r, 'week');
    expect(a.unit).toBe('week');
    expect(a.bottom[0]).toMatchObject({ from: 0, span: 5 });
    expect(a.bottom[1].date.getDay()).toBe(1);
    expect(a.bottom[1].span).toBe(7);
  });

  test('quarter zoom: years on top, months below', () => {
    const r = ganttRange([], NOW, 'quarter');
    const a = axisFor(r, 'quarter');
    expect(a.unit).toBe('month');
    expect(a.top.map((c) => c.date.getFullYear())).toEqual([2026, 2027]);
    expect(a.bottom.reduce((s, c) => s + c.span, 0)).toBe(r.days);
  });
});

describe('dayCells', () => {
  test('flags weekends and today', () => {
    const r = ganttRange([], NOW, 'day');
    const c = dayCells(r);
    expect(c[0].weekend).toBe(true); // Sun 18
    expect(c[1].weekend).toBe(false);
    expect(c.filter((x) => x.today).map((x) => x.date.getDate())).toEqual([21]);
  });
});

describe('closedRows', () => {
  test('keeps closed tasks finished inside the range, newest first', () => {
    const r = ganttRange([], NOW, 'day');
    const old = task('2026-06-01', { status: 'done', completed_at: '2026-06-02T10:00:00Z' });
    const a = task('2026-10-19', { status: 'done', completed_at: '2026-10-19T10:00:00Z' });
    const b = task('2026-10-20', { status: 'shelved', completed_at: null });
    const open = task('2026-10-20');
    expect(closedRows([old, a, b, open], r).map((x) => x.task.id)).toEqual([b.id, a.id]);
  });
});
