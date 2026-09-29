import { expect, test } from 'bun:test';
import { parseWhen } from '../src/parse/when';

const REF = new Date('2026-06-09T14:00:00+02:00');

test('"domani" → tomorrow at 09:30 default', () => {
  const r = parseWhen('domani', REF);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.iso.startsWith('2026-06-10T09:30')).toBe(true);
  }
});

test('"domani alle 14" → tomorrow 14:00', () => {
  const r = parseWhen('domani alle 14', REF);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.iso.startsWith('2026-06-10T14:00')).toBe(true);
});

test('configured default time is honored for timeless dates', () => {
  const r = parseWhen('domani', REF, { hour: 8, minute: 15 });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.iso.startsWith('2026-06-10T08:15')).toBe(true);
});

test('"tra 2 ore" → +2h from reference', () => {
  const r = parseWhen('tra 2 ore', REF);
  expect(r.ok).toBe(true);
  // Compare instants: the ISO string carries the runner's local offset, and
  // `bun test` runs in UTC, so a wall-clock prefix would only hold in CEST.
  if (r.ok) expect(new Date(r.iso).getTime()).toBe(REF.getTime() + 2 * 3600_000);
});

test('"alle 8" when already past 8 → bumps to next day same time', () => {
  const r = parseWhen('alle 8', REF);
  expect(r.ok).toBe(true);
  if (r.ok) {
    const d = new Date(r.iso);
    expect(d.getHours()).toBe(8);
    expect(d > REF).toBe(true);
  }
});

test('garbage input → ok=false with error message', () => {
  const r = parseWhen('blorp', REF);
  expect(r.ok).toBe(false);
});

test('English "tomorrow" → tomorrow at 09:30', () => {
  const r = parseWhen('tomorrow', REF);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.iso.startsWith('2026-06-10T09:30')).toBe(true);
});
