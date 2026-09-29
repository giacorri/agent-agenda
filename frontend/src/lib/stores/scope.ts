import { writable, derived, get } from 'svelte/store';
import type { Task, ScopeDef, ConfigBundle } from '$lib/types';
import { config } from '$lib/stores/config';
import * as m from '$lib/paraglide/messages';

// Scopes are config-driven: zero/one configured scope → a single agenda (no
// toggle); two → the classic work/personal split; N → an N-way switcher. A
// scope with an empty tag is the default scope (tasks carrying no scope tag);
// a scope with a tag holds tasks carrying that tag, and is "hidden" from the
// default scope. ALL shows everything.
export const ALL = '__all__';

const KEY = 'agenda-scope';

function load(): string {
  if (typeof localStorage === 'undefined') return ALL;
  return localStorage.getItem(KEY) ?? ALL;
}

// Active scope key (ALL = show everything). Persisted across reloads.
export const scope = writable<string>(load());
scope.subscribe((v) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v);
});

function hiddenTagSet(c: ConfigBundle): Set<string> {
  return new Set(c.scopes.filter((s) => s.tag).map((s) => s.tag.toLowerCase()));
}

// The first configured hidden (personal-like) scope, if any.
export function hiddenScope(c: ConfigBundle = get(config)): ScopeDef | undefined {
  return c.scopes.find((s) => s.tag);
}

// The default scope (empty tag), if any.
export function defaultScope(c: ConfigBundle = get(config)): ScopeDef | undefined {
  return c.scopes.find((s) => !s.tag);
}

// True when a task belongs to a hidden scope (carries one of the hidden tags).
export function isHidden(t: Task, c: ConfigBundle = get(config)): boolean {
  const hidden = hiddenTagSet(c);
  if (!hidden.size) return false;
  return (t.tags ?? []).some((tag) => hidden.has(tag.toLowerCase()));
}

// Membership test for the active scope. Fewer than two scopes → no filtering.
export function inScope(t: Task, activeKey: string, c: ConfigBundle = get(config)): boolean {
  const scopes = c.scopes;
  if (scopes.length < 2) return true;
  if (!activeKey || activeKey === ALL) return true;
  const sc = scopes.find((s) => s.key === activeKey);
  if (!sc) return true; // stale/unknown stored key → show all
  if (sc.tag) return (t.tags ?? []).some((tag) => tag.toLowerCase() === sc.tag.toLowerCase());
  return !isHidden(t, c); // default scope: nothing hidden
}

// Reactive task filter — recomputes when the active scope OR config changes.
export const scopeFilter = derived(
  [scope, config],
  ([$scope, $config]) => (t: Task) => inScope(t, $scope, $config)
);

// Toggle options: empty (toggle hidden) when fewer than two scopes are configured.
export const scopeOptions = derived(config, ($config) => {
  if ($config.scopes.length < 2) return [] as { key: string; label: string; icon: string }[];
  return [
    { key: ALL, label: m.scope_all(), icon: '' },
    ...$config.scopes.map((s) => ({ key: s.key, label: s.label, icon: s.icon ?? '' })),
  ];
});

// True when the active scope is a hidden/personal-like one.
export const activeScopeIsHidden = derived(
  [scope, config],
  ([$scope, $config]) => !!$config.scopes.find((s) => s.key === $scope)?.tag
);
