import { writable } from 'svelte/store';
import type { Task } from '$lib/types';

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
