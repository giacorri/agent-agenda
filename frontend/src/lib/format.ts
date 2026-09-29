// Locale-aware date/number formatting. Reads the active Paraglide locale, so the
// whole app re-formats when the language changes (Paraglide reloads on setLocale).
// One central place instead of 13 scattered 'it-IT' literals.
import { getLocale } from '$lib/i18n';
import * as m from '$lib/paraglide/messages';

// 'en' | 'it' are valid BCP-47 tags, so they pass straight to Intl.
const tag = (): string => getLocale();

// Generic formatter — pass the Intl options for the fields you want.
export const fmt = (d: string | Date, opts: Intl.DateTimeFormatOptions): string =>
  new Date(d).toLocaleString(tag(), opts);

// Named conveniences used across the views.
export const fmtFull = (d: string | Date): string =>
  fmt(d, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (d: string | Date): string =>
  fmt(d, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtDayTime = (d: string | Date): string =>
  fmt(d, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
// Compact all-numeric stamp for cards: day/month + 24h time, fixed day-month
// order regardless of locale ("15/06 09:30").
export const fmtDayTimeNum = (d: string | Date): string => {
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)} ${p(x.getHours())}:${p(x.getMinutes())}`;
};
// Date-only variant of the above ("15/06").
export const fmtDayNum = (d: string | Date): string => fmtDayTimeNum(d).split(' ')[0];
export const fmtWeekdayTime = (d: string | Date): string =>
  fmt(d, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtTime = (d: string | Date): string =>
  fmt(d, { hour: '2-digit', minute: '2-digit' });
export const fmtDayShort = (d: string | Date): string =>
  fmt(d, { weekday: 'short', day: '2-digit' });
export const fmtDayMonth = (d: string | Date): string =>
  fmt(d, { day: '2-digit', month: 'short' });
export const fmtDayMonthLong = (d: string | Date): string =>
  fmt(d, { day: '2-digit', month: 'long' });
export const fmtWeekdayDayMonthLong = (d: string | Date): string =>
  fmt(d, { weekday: 'long', day: '2-digit', month: 'long' });
export const monthLabel = (d: string | Date): string =>
  fmt(d, { month: 'long', year: 'numeric' });
export const monthLong = (d: string | Date): string =>
  fmt(d, { month: 'long' });

// ---- key → translated label (decoupled from grouping keys, see #20) -------
const BUCKET_LABELS: Record<string, () => string> = {
  earlier: m.bucket_earlier, last_week: m.bucket_last_week,
  earlier_this_week: m.bucket_earlier_this_week, yesterday: m.bucket_yesterday,
  today: m.bucket_today, tomorrow: m.bucket_tomorrow, this_week: m.bucket_this_week,
  later: m.bucket_later, general: m.bucket_general, done: m.bucket_done, closed: m.bucket_closed,
};
export const bucketLabel = (key: string): string => (BUCKET_LABELS[key] ?? (() => key))();

// Short labels for the per-card overdue age badge (compact view), kept separate
// from the longer section headers above.
const BUCKET_AGE_LABELS: Record<string, () => string> = {
  yesterday: m.bucket_age_yesterday, earlier_this_week: m.bucket_age_earlier_this_week,
  last_week: m.bucket_age_last_week, earlier: m.bucket_age_earlier,
};
export const bucketAgeLabel = (key: string): string => (BUCKET_AGE_LABELS[key] ?? (() => bucketLabel(key)))();

const STATUS_LABELS: Record<string, () => string> = {
  pending: m.status_pending, in_progress: m.status_in_progress,
  snoozed: m.status_snoozed, done: m.status_done, shelved: m.status_shelved,
};
export const statusLabel = (status: string): string => (STATUS_LABELS[status] ?? (() => status))();
