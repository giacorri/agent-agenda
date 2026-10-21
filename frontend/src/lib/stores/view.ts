import { writable } from 'svelte/store';
import type { Task } from '$lib/types';
import { ZOOMS, type Zoom } from '$lib/gantt';

// Agenda layout preference, persisted across reloads (same pattern as scope).
// 'compact'  → one continuous grid; each card carries a bucket badge.
// 'sections' → one titled section per bucket (more whitespace, clearer split).
export type ViewMode = 'compact' | 'sections';

const KEY = 'agenda-view';

function load(): ViewMode {
  if (typeof localStorage === 'undefined') return 'compact';
  return localStorage.getItem(KEY) === 'sections' ? 'sections' : 'compact';
}

export const viewMode = writable<ViewMode>(load());
viewMode.subscribe((v) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v);
});

// Peek mode: short cards that expand on hover. Off → cards show their full
// content statically (no clip, no hover overlay). Persisted like the view mode.
const PEEK_KEY = 'agenda-peek';

function loadPeek(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(PEEK_KEY) !== 'off';
}

export const peekMode = writable<boolean>(loadPeek());
peekMode.subscribe((v) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(PEEK_KEY, v ? 'on' : 'off');
});

// Timeline layout: 'days' (default) lists open work day by day; 'gantt' plots the
// same work on a time axis. Persisted like the agenda view mode.
export type TimelineMode = 'days' | 'gantt';
const TL_KEY = 'timeline-mode';

function loadTimelineMode(): TimelineMode {
  try { return localStorage.getItem(TL_KEY) === 'gantt' ? 'gantt' : 'days'; } catch { return 'days'; }
}

export const timelineMode = writable<TimelineMode>(loadTimelineMode());
timelineMode.subscribe((v) => {
  try { localStorage.setItem(TL_KEY, v); } catch { /* storage unavailable: keep it in memory */ }
});

// Gantt preferences, remembered per browser like the timeline mode: zoom level,
// whether closed tasks are shown, and the width of the task column.
function persisted<T>(key: string, parse: (raw: string | null) => T, dump: (v: T) => string) {
  let init: T;
  try { init = parse(localStorage.getItem(key)); } catch { init = parse(null); }
  const store = writable<T>(init);
  store.subscribe((v) => {
    try { localStorage.setItem(key, dump(v)); } catch { /* storage unavailable: keep it in memory */ }
  });
  return store;
}

export const ganttZoom = persisted<Zoom>('gantt-zoom',
  (raw) => (ZOOMS as readonly string[]).includes(raw ?? '') ? raw as Zoom : 'day', String);
export const ganttShowClosed = persisted<boolean>('gantt-show-closed', (raw) => raw === 'on', (v) => v ? 'on' : 'off');
export const GANTT_LABEL_MIN = 160;
export const GANTT_LABEL_MAX = 560;
export const ganttLabelWidth = persisted<number>('gantt-label-width', (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= GANTT_LABEL_MIN && n <= GANTT_LABEL_MAX ? n : 300;
}, String);

// Add-issue modal open state (transient). Mounted in the layout, outside the
// topbar, so its fixed overlay anchors to the viewport (the glass topbar's
// backdrop-filter would otherwise become the containing block).
export const addOpen = writable(false);

// Two-stage handshake for the modal→card flight, so the phases stay sequential even
// though the WebSocket inserts the created task on its own schedule:
//  formingId  → card kept OUT of the layout (display:none) while the ghost takes shape,
//               so neighbours don't make room yet;
//  creatingId → card back IN the layout but invisible (opacity:0) — neighbours make
//               room (flip) as the ghost flies, revealed when it lands.
export const formingId = writable<string | null>(null);
export const creatingId = writable<string | null>(null);

// The card flying from the modal to its agenda slot. `from` is the modal box, `colW`
// the current card-column width; FlyingCard forms the card at the modal, then inserts
// the real card and reads its slot to fly there.
type Box = { x: number; y: number; w: number; h: number };
export const flying = writable<{ from: Box; colW: number; task: Task } | null>(null);

// One-line transient notice rendered by the layout (e.g. a deep link to a task that
// no longer exists). Auto-clears; a newer notice replaces the previous one.
export const notice = writable<string | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
export function showNotice(text: string, ms = 6000) {
  notice.set(text);
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.set(null), ms);
}
