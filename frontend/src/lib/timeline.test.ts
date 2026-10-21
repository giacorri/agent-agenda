import { describe, expect, test } from 'bun:test';
import { groupByDay, parseDue, daysLate } from './timeline';
import type { Task } from './types';

let seq = 0;
function task(due_at: string, over: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `t${seq}`, title: `task ${seq}`, summary: null, due_at, remind_at: '', status: 'pending',
    priority: 2, services: [], tags: [], source: 'agent', requester: null, people: [], client: null,
    closing: null, agent_session: null, agent_cwd: null, created_at: `2026-01-01T00:00:0${seq % 10}Z`,
    completed_at: null, notified_at: null, steps: [], ...over,
  };
}

// Wednesday 21 October 2026, 14:00 local (tests run with TZ=Europe/Rome).
const NOW = new Date(2026, 9, 21, 14, 0);
const titles = (s: { items: { task: Task }[] }) => s.items.map((i) => i.task.title);

describe('parseDue', () => {
  test('empty means no date', () => {
    expect(parseDue('')).toBeNull();
  });
  test('date-only is local midnight of that day, all-day', () => {
    const d = parseDue('2026-10-21')!;
    expect(d.allDay).toBe(true);
    expect([d.at.getFullYear(), d.at.getMonth(), d.at.getDate(), d.at.getHours()]).toEqual([2026, 9, 21, 0]);
  });
  test('ISO datetime with offset keeps the instant', () => {
    const d = parseDue('2026-10-21T07:30:00Z')!;
    expect(d.allDay).toBe(false);
    expect(d.at.getTime()).toBe(Date.UTC(2026, 9, 21, 7, 30));
  });
  test('garbage is treated as no date', () => {
    expect(parseDue('not a date')).toBeNull();
  });
});

describe('groupByDay', () => {
  test('sections run overdue → today → tomorrow → weekdays → months', () => {
    const { sections } = groupByDay([
      task('2026-12-03', { title: 'december' }),
      task('2026-10-27T09:00:00+01:00', { title: 'tuesday' }),
      task('2026-10-22', { title: 'tomorrow' }),
      task('2026-10-21T16:00:00+02:00', { title: 'today' }),
      task('2026-10-15', { title: 'last week' }),
      task('2026-10-30', { title: 'later this month' }),
    ], NOW);
    expect(sections.map((s) => s.kind)).toEqual(['overdue', 'today', 'tomorrow', 'day', 'month', 'month']);
    expect(sections.map((s) => titles(s)[0])).toEqual(['last week', 'today', 'tomorrow', 'tuesday', 'later this month', 'december']);
  });

  test('today is always present, even with nothing due', () => {
    const { sections } = groupByDay([task('2026-11-20')], NOW);
    expect(sections[0].kind).toBe('today');
    expect(sections[0].items).toHaveLength(0);
  });

  test('done and shelved are left out; undated go apart', () => {
    const { sections, undated } = groupByDay([
      task('2026-10-21', { status: 'done', title: 'done' }),
      task('2026-10-21', { status: 'shelved', title: 'shelved' }),
      task('2026-10-21', { status: 'in_progress', title: 'wip' }),
      task('', { title: 'no date' }),
      task('', { title: 'no date done', status: 'done' }),
    ], NOW);
    expect(titles(sections[0])).toEqual(['wip']);
    expect(undated.map((t) => t.title)).toEqual(['no date']);
  });

  test('inside a day: priority, then all-day, then time', () => {
    const { sections } = groupByDay([
      task('2026-10-21T18:00:00+02:00', { title: 'evening' }),
      task('2026-10-21T09:00:00+02:00', { title: 'morning' }),
      task('2026-10-21', { title: 'all day' }),
      task('2026-10-21T20:00:00+02:00', { title: 'urgent', priority: 1 }),
    ], NOW);
    expect(titles(sections[0])).toEqual(['urgent', 'all day', 'morning', 'evening']);
  });

  test('a timed task due earlier today stays in today but is late; all-day today is not', () => {
    const { sections } = groupByDay([
      task('2026-10-21T09:00:00+02:00', { title: 'missed' }),
      task('2026-10-21', { title: 'all day' }),
    ], NOW);
    expect(sections).toHaveLength(1);
    const late = Object.fromEntries(sections[0].items.map((i) => [i.task.title, i.late]));
    expect(late).toEqual({ missed: true, 'all day': false });
  });

  test('overdue is oldest first and every item is late', () => {
    const { sections } = groupByDay([
      task('2026-10-20', { title: 'yesterday' }),
      task('2026-09-01T10:00:00+02:00', { title: 'september' }),
    ], NOW);
    expect(titles(sections[0])).toEqual(['september', 'yesterday']);
    expect(sections[0].items.every((i) => i.late)).toBe(true);
  });

  test('day window is configurable', () => {
    const { sections } = groupByDay([task('2026-10-24')], NOW, 2);
    expect(sections.map((s) => s.kind)).toEqual(['today', 'month']);
  });

  test('daysLate counts calendar days', () => {
    expect(daysLate(parseDue('2026-10-20')!, NOW)).toBe(1);
    expect(daysLate(parseDue('2026-10-21T01:00:00+02:00')!, NOW)).toBe(0);
  });
});
