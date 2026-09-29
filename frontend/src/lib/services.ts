// Category/app metadata (label/icon/color) and the work-vs-app split now live in
// the config store (see $lib/stores/config: categoryMeta / isApp / taskColor).
// This module only keeps the small, content-driven icon maps that aren't part of
// the configurable category registry.

// Per-tag icon so each tag reads at a glance; falls back to a generic tag icon.
const TAG_ICONS: Record<string, string> = {
  security: 'lock', secret: 'key', crypto: 'key', mfa: 'lock',
  ci: 'beaker', flake: 'bug', test: 'beaker',
  quality: 'spark', 'tech-debt': 'spark', refactor: 'spark',
  deploy: 'rocket', release: 'rocket', benchmark: 'chart', 'high-risk': 'alert',
  docs: 'book', runbook: 'book',
  infra: 'cloud', iac: 'cloud', cloud: 'cloud',
  ops: 'wrench', review: 'eye',
  handoff: 'userplus', onboarding: 'userplus', resume: 'play',
  personal: 'user',
};
export function tagIcon(name: string): string {
  return TAG_ICONS[name.toLowerCase()] ?? 'tag';
}
