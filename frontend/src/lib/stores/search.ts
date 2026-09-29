import { writable, derived } from 'svelte/store';
import type { ConfigBundle, Task } from '$lib/types';
import { config } from '$lib/stores/config';
import { tasks } from '$lib/stores/tasks';
import { scopeFilter } from '$lib/stores/scope';

// Free-text query shared by every screen. Deliberately NOT persisted: a search is a
// transient lens over whatever the current view already shows (agenda, week, month,
// or a requester/tag/service/status page), never a saved filter.
export const query = writable<string>('');

// Accent- and case-insensitive folding, so "città" matches "citta" and vice versa.
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Terms are ANDed: every word typed must appear somewhere in the task's text.
export const searchTerms = derived(query, ($q) => fold($q).split(/\s+/).filter(Boolean));
export const searchActive = derived(searchTerms, ($t) => $t.length > 0);

// Everything a task can be found by. Category and person KEYS are indexed next to
// their configured LABELS, so "Jane" finds a task whose requester is "jane.doe"
// and "Web App" finds one carrying the category key "web-app".
function build(t: Task, c: ConfigBundle): string {
  const parts: (string | null | undefined)[] = [
    t.title, t.summary, t.requester, t.client, t.closing, t.id, t.status,
    ...(t.tags ?? []), ...(t.services ?? []), ...(t.steps ?? []),
    t.last_note?.body,
  ];
  for (const s of t.services ?? []) {
    const meta = c.categories.find((x) => x.key.toLowerCase() === s.toLowerCase());
    if (meta) parts.push(meta.label);
  }
  if (t.requester) {
    const p = c.people.find((x) => t.requester!.toLowerCase().includes(x.key.toLowerCase()));
    if (p) parts.push(p.label, p.role);
  }
  if (t.client) {
    const cl = c.clients.find((x) => t.client!.toLowerCase().includes(x.key.toLowerCase()));
    if (cl) parts.push(cl.label);
  }
  return fold(parts.filter(Boolean).join(' '));
}

// Per-task index cache. Safe because the task store only ever REPLACES task objects
// (see upsert in stores/tasks.ts) — a mutated-in-place task would keep a stale index.
// Dropped wholesale when the config bundle changes, since labels feed the index.
let cacheCfg: ConfigBundle | null = null;
let cache = new WeakMap<Task, string>();
function haystack(t: Task, c: ConfigBundle): string {
  if (c !== cacheCfg) { cacheCfg = c; cache = new WeakMap(); }
  let h = cache.get(t);
  if (h === undefined) { h = build(t, c); cache.set(t, h); }
  return h;
}

// One-off predicate for a query that lives outside the global box (the prerequisite
// picker in the drawer): same index, same AND-of-terms rule, no shared state touched.
export function matcher(q: string, c: ConfigBundle): (t: Task) => boolean {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return () => true;
  return (t) => { const h = haystack(t, c); return terms.every((w) => h.includes(w)); };
}

// Bumped by whoever wants the global box focused (e.g. "pick from the agenda" mode);
// SearchBox watches it. A counter, so two requests in a row both fire.
export const focusRequest = writable(0);
export const requestSearchFocus = () => focusRequest.update((n) => n + 1);

// Reactive predicate, mirroring scopeFilter: views AND the two together. An empty
// query matches everything, so a view can apply it unconditionally.
export const searchFilter = derived(
  [searchTerms, config],
  ([$terms, $config]) => {
    if (!$terms.length) return (_t: Task) => true;
    return (t: Task) => {
      const h = haystack(t, $config);
      return $terms.every((w) => h.includes(w));
    };
  }
);

// Matches across the WHOLE agenda in the active scope — what the box reports next to
// the input, so a search inside a filtered view still tells you if there are hits
// outside it.
export const globalMatches = derived(
  [tasks, scopeFilter, searchFilter],
  ([$tasks, $scope, $search]) => $tasks.filter((t) => $scope(t) && $search(t)).length
);
