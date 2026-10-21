// Runs under TZ=Europe/Rome (see package.json), where UTC midnight is 01:00/02:00 local.
import { describe, expect, test } from 'bun:test';
import { parseDue, dueDate, dueMs, dueDeadline, isPastDue, cmpDueAt } from './due';

describe('parseDue', () => {
  test('empty or missing is no due', () => {
    expect(parseDue('')).toBeNull();
    expect(parseDue(null)).toBeNull();
    expect(parseDue(undefined)).toBeNull();
    expect(dueDate('')).toBeNull();
    expect(Number.isNaN(dueMs(''))).toBe(true);
  });

  test('date-only is local midnight of that day, not 02:00 (UTC midnight)', () => {
    const d = parseDue('2026-10-21')!;
    expect(d.allDay).toBe(true);
    expect([d.at.getFullYear(), d.at.getMonth(), d.at.getDate(), d.at.getHours(), d.at.getMinutes()]).toEqual([2026, 9, 21, 0, 0]);
    expect(new Date('2026-10-21').getHours()).toBe(2); // what the old `new Date(due_at)` gave
  });

  test('date-only across the DST change stays on its calendar day', () => {
    const d = parseDue('2026-10-25')!; // clocks go back that night in Rome
    expect([d.at.getDate(), d.at.getHours()]).toEqual([25, 0]);
    expect(dueDeadline(d) - d.at.getTime()).toBe(25 * 3_600_000);
  });

  test('datetime with offset is that instant', () => {
    const d = parseDue('2026-10-21T09:30:00+02:00')!;
    expect(d.allDay).toBe(false);
    expect(d.at.toISOString()).toBe('2026-10-21T07:30:00.000Z');
    expect(dueMs('2026-10-21T07:30:00Z')).toBe(d.at.getTime());
  });

  test('a late-evening UTC datetime lands on the next local day', () => {
    const d = parseDue('2026-10-20T23:30:00Z')!; // 01:30 on the 21st in Rome
    expect(d.at.getDate()).toBe(21);
  });

  test('garbage is no due', () => {
    expect(parseDue('soon')).toBeNull();
  });
});

describe('isPastDue', () => {
  test('a date-only due stays on time for its whole day', () => {
    expect(isPastDue('2026-10-21', new Date(2026, 9, 21, 3, 0))).toBe(false);
    expect(isPastDue('2026-10-21', new Date(2026, 9, 21, 23, 59))).toBe(false);
    expect(isPastDue('2026-10-21', new Date(2026, 9, 22, 0, 0))).toBe(true);
  });

  test('a timed due is late from its instant', () => {
    expect(isPastDue('2026-10-21T09:30:00+02:00', new Date(2026, 9, 21, 9, 29))).toBe(false);
    expect(isPastDue('2026-10-21T09:30:00+02:00', new Date(2026, 9, 21, 9, 31))).toBe(true);
  });

  test('no due is never late', () => {
    expect(isPastDue('', new Date())).toBe(false);
  });
});

describe('cmpDueAt', () => {
  test('orders by instant across offsets, empty last', () => {
    const list = ['', '2026-10-21T20:00:00+00:00', '2026-10-21T21:00:00+02:00', '2026-10-21'];
    expect(list.slice().sort(cmpDueAt)).toEqual(['2026-10-21', '2026-10-21T21:00:00+02:00', '2026-10-21T20:00:00+00:00', '']);
  });

  test('a date-only day sorts before a timed due at local midnight of the same day', () => {
    expect(cmpDueAt('2026-10-21', '2026-10-21T00:00:00+02:00')).toBeLessThan(0);
  });
});
