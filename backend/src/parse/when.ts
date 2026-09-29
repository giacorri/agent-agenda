import * as chrono from 'chrono-node';

export type ParseResult =
  | { ok: true; iso: string; hadTime: boolean }
  | { ok: false; error: string };

const DEFAULT_HOUR = 9;
const DEFAULT_MINUTE = 30;

// The fallback time applied when a date is given without a time (e.g. "domani").
// Server-configurable via settings; falls back to 09:30.
export interface WhenDefaults { hour: number; minute: number; }
const FALLBACK_DEFAULTS: WhenDefaults = { hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE };

const IT_FALLBACK: Array<[RegExp, (m: RegExpMatchArray, now: Date, def: WhenDefaults) => { d: Date; hadTime: boolean }]> = [
  [/^stasera$/i, (_, now) => ({ d: atHour(now, 20, 0), hadTime: true })],
  [/^stanotte$/i, (_, now) => ({ d: atHour(now, 22, 0), hadTime: true })],
  [/^domani\s+alle\s+(\d{1,2})(?::(\d{2}))?$/i, (m, now) =>
    ({ d: atHour(addDays(now, 1), Number(m[1]), Number(m[2] ?? '0')), hadTime: true })],
  [/^dopodomani\s+alle\s+(\d{1,2})(?::(\d{2}))?$/i, (m, now) =>
    ({ d: atHour(addDays(now, 2), Number(m[1]), Number(m[2] ?? '0')), hadTime: true })],
  [/^domani$/i, (_, now, def) => ({ d: atHour(addDays(now, 1), def.hour, def.minute), hadTime: false })],
  [/^dopodomani$/i, (_, now, def) => ({ d: atHour(addDays(now, 2), def.hour, def.minute), hadTime: false })],
  [/^alle\s+(\d{1,2})(?::(\d{2}))?$/i, (m, now) => {
    const h = Number(m[1]);
    const mm = Number(m[2] ?? '0');
    let d = atHour(now, h, mm);
    if (d <= now) d = addDays(d, 1);
    return { d, hadTime: true };
  }],
  [/^tra\s+(\d+)\s+ore?$/i, (m, now) => ({ d: addHours(now, Number(m[1])), hadTime: true })],
  [/^tra\s+(\d+)\s+minut/i, (m, now) => ({ d: addMinutes(now, Number(m[1])), hadTime: true })],
  [/^tra\s+(\d+)\s+giorni?$/i, (m, now, def) => ({ d: atHour(addDays(now, Number(m[1])), def.hour, def.minute), hadTime: false })],
];

function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addHours(d: Date, n: number): Date { const x = new Date(d); x.setHours(x.getHours() + n); return x; }
function addMinutes(d: Date, n: number): Date { const x = new Date(d); x.setMinutes(x.getMinutes() + n); return x; }
function atHour(d: Date, h: number, m: number): Date {
  const x = new Date(d); x.setHours(h, m, 0, 0); return x;
}

function toIsoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  const tzH = pad(Math.floor(Math.abs(tz) / 60));
  const tzM = pad(Math.abs(tz) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${tzH}:${tzM}`;
}

export function parseWhen(input: string, now: Date = new Date(), def: WhenDefaults = FALLBACK_DEFAULTS): ParseResult {
  const trimmed = input.trim();

  for (const [re, fn] of IT_FALLBACK) {
    const m = trimmed.match(re);
    if (m) {
      const { d, hadTime } = fn(m, now, def);
      return { ok: true, iso: toIsoLocal(d), hadTime };
    }
  }

  const results = chrono.parse(trimmed, now, { forwardDate: true });
  if (!results.length) return { ok: false, error: `could not parse "${input}"` };

  const r = results[0];
  const hadTime = r.start.isCertain('hour');
  let d = r.start.date();

  if (!hadTime) {
    d.setHours(def.hour, def.minute, 0, 0);
  }

  if (d <= now) {
    d = addDays(d, 1);
  }

  return { ok: true, iso: toIsoLocal(d), hadTime };
}
