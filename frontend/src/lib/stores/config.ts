import { writable, derived, get } from 'svelte/store';
import type { Category, Person, Client, RefMapping, ScopeDef, ConfigBundle, Task } from '$lib/types';
import { api } from '$lib/api';
import { onWs } from '$lib/ws';

// The whole server config bundle, loaded once on boot and refreshed on the
// config.updated WS event. Ships EMPTY — every helper degrades gracefully so the
// app renders fine on a fresh, unconfigured install.
const EMPTY: ConfigBundle = { categories: [], people: [], clients: [], refs: [], scopes: [], settings: {} };

export const config = writable<ConfigBundle>(EMPTY);

export const categories = derived(config, ($c) => $c.categories);
export const people = derived(config, ($c) => $c.people);
export const clients = derived(config, ($c) => $c.clients);
export const refs = derived(config, ($c) => $c.refs);
export const scopes = derived(config, ($c) => $c.scopes);
export const settings = derived(config, ($c) => $c.settings);

// True once the bundle has been fetched at least once (regardless of emptiness).
export const configLoaded = writable(false);

// True when the instance has any configuration at all. False = fresh first-run install.
export const configured = derived(config, ($c) =>
  $c.categories.length > 0 || $c.people.length > 0 || $c.clients.length > 0 ||
  $c.refs.length > 0 || $c.scopes.length > 0 || Object.keys($c.settings).length > 0
);

let wsBound = false;
export async function initConfig(): Promise<void> {
  try {
    config.set(await api.getConfig());
  } catch (e) {
    console.error('agent-agenda: api.getConfig failed', e);
  } finally {
    configLoaded.set(true);
  }
  if (wsBound) return;
  wsBound = true;
  onWs((m) => {
    if (m.type === 'config.updated') {
      api.getConfig().then((b) => config.set(b)).catch(() => {});
    }
  });
}

// ---- snapshot helpers (replace the old module constants) ------------------
// Each takes an optional bundle so a component can pass the reactive `$config`
// for live updates, or omit it for a one-off snapshot read (e.g. markdown).

function fallbackMeta(key: string): Category {
  return { key, label: key, icon: 'dot', color: '#8896a8', kind: 'service', sort: 0 };
}

export function categoryMeta(key: string, c: ConfigBundle = get(config)): Category {
  const k = key.toLowerCase();
  return c.categories.find((x) => x.key.toLowerCase() === k) ?? fallbackMeta(key);
}

export function isApp(key: string, c: ConfigBundle = get(config)): boolean {
  const k = key.toLowerCase();
  return c.categories.some((x) => x.key.toLowerCase() === k && x.kind === 'app');
}

// Stable hue (0-359) from a string, for tasks whose category isn't configured.
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

// A task's accent colour: its primary category's configured colour, else a stable
// hashed hue from its first tag / title so every row still reads as its own colour.
export function taskColor(t: Task, c: ConfigBundle = get(config)): string {
  const svc = (t.services ?? []).find((s) => s);
  if (svc) {
    const meta = c.categories.find((x) => x.key.toLowerCase() === svc.toLowerCase());
    if (meta) return meta.color;
  }
  const seed = (t.tags ?? []).find((x) => x && x !== 'personal') ?? t.title ?? t.id;
  return `hsl(${hashHue(seed)}, 62%, 63%)`;
}

export function requesterMatches(requester: string | null | undefined, key: string): boolean {
  if (!requester) return false;
  return requester.toLowerCase().includes(key.toLowerCase());
}

export function personFor(requester: string | null | undefined, c: ConfigBundle = get(config)): Person | undefined {
  if (!requester) return undefined;
  return c.people.find((p) => requesterMatches(requester, p.key));
}

// Clients match exactly like requesters: the task's free-text `client` is compared
// case-insensitively against the configured key, as a substring — so "Acme Inc"
// still resolves to the client keyed "acme".
export const clientMatches = requesterMatches;

export function clientFor(client: string | null | undefined, c: ConfigBundle = get(config)): Client | undefined {
  if (!client) return undefined;
  return c.clients.find((x) => clientMatches(client, x.key));
}

// Shorthand is optional: "web#98" is qualified, "#98" is bare (resolved against the
// task's default repo). "PR" after the # (or "PR#98") routes to a pull request.
const REF_RE = /(?<![\w/])([a-z][a-z0-9_.-]*)?#(pr)?(\d{1,6})\b/gi;

export interface RepoTarget { owner_repo: string; host: string }

// A task's default repo for BARE refs, derived from its tags/services matching a
// configured ref shorthand — but only when exactly one repo matches, so "#98" is
// never ambiguous. Lets a web-app task write "#70" / "PR#98" without a prefix.
export function taskRepo(
  task: { tags?: string[]; services?: string[] },
  c: ConfigBundle = get(config)
): RepoTarget | null {
  const keys = new Set([...(task.tags ?? []), ...(task.services ?? [])].map((s) => s.toLowerCase()));
  const hits = c.refs.filter((r) => keys.has(r.shorthand.toLowerCase()));
  if (new Set(hits.map((r) => r.owner_repo)).size !== 1) return null;
  return { owner_repo: hits[0].owner_repo, host: hits[0].host || 'github.com' };
}

const link = (label: string, host: string, owner_repo: string, pr: boolean, num: string) =>
  `[${label}](https://${host}/${owner_repo}/${pr ? 'pull' : 'issues'}/${num})`;

// Match a written ref token to a configured repo. Deliberately tolerant: an agent
// rarely types the exact shorthand. Tries exact shorthand first, then a separator-
// and prefix-insensitive compare of the *tail* name (segment after the last "/" and
// "."), so "acme_web" (config has "acme-web") and "acme.infra.ci-tools"
// (config shorthand "ci-tools") both resolve. The matched shorthand becomes the
// rendered label, unifying the style across variant spellings.
const normRef = (s: string) => s.toLowerCase().replace(/[_.-]/g, '');
const refTail = (s: string) => (s.split('/').pop() ?? s).split('.').pop() ?? s;
function findRef(key: string, c: ConfigBundle): RefMapping | undefined {
  const exact = c.refs.find((r) => r.shorthand.toLowerCase() === key);
  if (exact) return exact;
  const kt = normRef(refTail(key));
  if (!kt) return undefined;
  return c.refs.find((r) => normRef(refTail(r.shorthand)) === kt || normRef(refTail(r.owner_repo)) === kt);
}

const repoLink = (label: string, host: string, owner_repo: string) =>
  `[${label}](https://${host}/${owner_repo})`;

// A bare repo mention with no #N, written as a multi-segment dotted name
// ("acme.web.app", "acme.infra.ci-tools"), links to the repo root. Restricted to
// dotted tokens so plain words ("core", "web") never auto-link by accident.
const BARE_REPO_RE = /(?<![\w/#.-])([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+)(?![\w#-])/gi;

// Expand "web#498" (issue) / "web#PR498" (pull) via configured shorthands, bare
// "#498" / "PR#498" against `repo`, and bare dotted repo names → repo root. PR → /pull/N.
export function expandRefs(
  src: string,
  repo: RepoTarget | null = null,
  c: ConfigBundle = get(config)
): string {
  // Bare dotted repo names first, so the dotted names inside the issue/PR URLs the
  // #-ref pass generates below are never re-matched.
  const withRepos = src.replace(BARE_REPO_RE, (m, name: string) => {
    const map = findRef(name.toLowerCase(), c);
    return map ? repoLink(name, map.host || 'github.com', map.owner_repo) : m;
  });
  return withRepos.replace(REF_RE, (m, raw: string | undefined, pr: string | undefined, num: string) => {
    if (raw) {
      const key = raw.toLowerCase();
      const map = findRef(key, c);
      if (map) {
        const sh = map.shorthand;
        return link(pr ? `${sh}#PR${num}` : `${sh}#${num}`, map.host || 'github.com', map.owner_repo, !!pr, num);
      }
      // "PR#98" reads as raw="pr": treat as a bare pull ref when a default repo exists.
      if (key === 'pr' && repo) return link(`PR#${num}`, repo.host, repo.owner_repo, true, num);
      return m;
    }
    if (!repo) return m; // bare ref, no default repo → leave untouched
    return link(pr ? `#PR${num}` : `#${num}`, repo.host, repo.owner_repo, !!pr, num);
  });
}

export function scopeList(c: ConfigBundle = get(config)): ScopeDef[] {
  return c.scopes;
}

export function setting(key: string, fallback = '', c: ConfigBundle = get(config)): string {
  return c.settings[key] ?? fallback;
}
