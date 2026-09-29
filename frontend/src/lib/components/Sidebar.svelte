<script lang="ts">
  import { page } from '$app/state';
  import { tasks } from '$lib/stores/tasks';
  import { scope, ALL, scopeFilter, activeScopeIsHidden } from '$lib/stores/scope';
  import { tagIcon } from '$lib/services';
  import { config, categoryMeta, isApp, people as peopleStore, clients as clientsStore, requesterMatches, clientMatches } from '$lib/stores/config';
  import { isOpen } from '$lib/time';
  import { subjectsOf, topicsOf, daysUntil, progressOf } from '$lib/study';
  import ScopeToggle from './ScopeToggle.svelte';
  import SearchBox from './SearchBox.svelte';
  import Icon from './Icon.svelte';
  import PersonAvatar from './PersonAvatar.svelte';
  import ClientLogo from './ClientLogo.svelte';
  import * as m from '$lib/paraglide/messages';
  import type { Task } from '$lib/types';

  // The sidebar follows the global scope toggle; "personal" = the active scope is a hidden one.
  const personal = $derived($activeScopeIsHidden);
  const curPath = $derived(page.url.pathname as string);
  const scoped = $derived(($tasks as Task[]).filter((t) => $scopeFilter(t)));

  // Subjects (exam mode) show when the active scope is a study one, or in ALL.
  const subjectKeys = $derived(new Set($config.categories.filter((c) => c.kind === 'subject').map((c) => c.key.toLowerCase())));
  const activeScopeDef = $derived($config.scopes.find((s) => s.key === $scope));
  const isAllScope = $derived(!$scope || $scope === ALL);
  const showSubjects = $derived(isAllScope || activeScopeDef?.type === 'study');
  const subjects = $derived(showSubjects ? subjectsOf($config) : []);
  const subjectRows = $derived(subjects.map((s) => {
    const pr = progressOf(topicsOf($tasks as Task[], s.key));
    return { s, days: daysUntil(s.exam_date), done: pr.done, total: pr.total, pct: pr.pct };
  }));

  const activeTasks = $derived(scoped.filter(isOpen));
  const openCount = $derived(activeTasks.length);
  const doneCount = $derived(scoped.filter((t) => t.status === 'done').length);

  const services = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const t of activeTasks) {
      for (const s of t.services) if (s && s.trim()) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  });
  // Split work services from personal apps so apps stay visible (not buried) in 'both' scope.
  // Subjects live in their own "Subjects" block, so keep them out of services.
  const workServices = $derived(services.filter(([s]) => !isApp(s, $config) && !subjectKeys.has(s.toLowerCase())));
  const personalApps = $derived(services.filter(([s]) => isApp(s, $config)));

  const tags = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const t of activeTasks) {
      for (const tag of t.tags) if (tag && tag.trim() && tag !== 'personal') counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  });

  // Configured roster of requesters, with the count of their open tasks.
  // Requesters with nothing open are hidden from the sidebar.
  const people = $derived(
    $peopleStore
      .map((p) => ({ ...p, count: activeTasks.filter((t) => requesterMatches(t.requester, p.key)).length }))
      .filter((p) => p.count > 0)
  );

  // Same rule for clients: only the ones with open work show up. Work-only, like
  // requesters — a personal task has no client.
  const clients = $derived(
    $clientsStore
      .map((c) => ({ ...c, count: activeTasks.filter((t) => clientMatches(t.client, c.key)).length }))
      .filter((c) => c.count > 0)
  );
</script>

<aside>
  <a class="logo" href="/" title={m.logo_tooltip()}>
    <span class="logo-mark"><Icon name="rocket" size={18} /></span>
    <span class="logo-text"><span class="l1">Agent</span><span class="l2">Agenda</span></span>
  </a>

  <ScopeToggle />

  <!-- Lives in the sidebar so the box is on every screen — the filtered
       requester/tag/service/status pages included. -->
  <SearchBox />

  <div class="stats">
    <a href="/status/open" class:active={curPath === '/status/open'}><span>{m.view_open()}</span><b>{openCount}</b></a>
    <a href="/status/done" class:active={curPath === '/status/done'}><span>{m.view_done()}</span><b>{doneCount}</b></a>
  </div>

  {#if !personal && people.length}
    <div class="block">
      <h3>{m.sidebar_requesters()}</h3>
      <ul>
        {#each people as p}
          <li>
            <a href={`/requester/${encodeURIComponent(p.key)}`} class:active={decodeURIComponent(page.params.name ?? '') === p.key} title={`${p.label} — ${p.role}`}>
              <span class="ico"><PersonAvatar photo={p.photo} size={20} alt={p.label} /></span>
              <span class="lbl">{p.label}</span>
              <span class="count">{p.count}</span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if !personal && clients.length}
    <div class="block">
      <h3>{m.sidebar_clients()}</h3>
      <ul>
        {#each clients as c}
          <li>
            <a href={`/client/${encodeURIComponent(c.key)}`} class:active={curPath.startsWith('/client/') && decodeURIComponent(page.params.key ?? '') === c.key} title={c.label}>
              <span class="ico"><ClientLogo logo={c.logo} size={20} alt={c.label} /></span>
              <span class="lbl">{c.label}</span>
              <span class="count">{c.count}</span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if subjectRows.length}
    <div class="block">
      <h3>{m.study_subjects()}</h3>
      <ul class="subj">
        {#each subjectRows as r (r.s.key)}
          <li>
            <a href={`/service/${encodeURIComponent(r.s.key)}`} style={`--svc:${r.s.color}`}>
              <span class="ico"><Icon name={r.s.icon} size={15} /></span>
              <span class="sbody">
                <span class="stop">
                  <span class="lbl">{r.s.label}</span>
                  <span class="cd" class:soon={r.days >= 0 && r.days <= 7} class:over={r.days < 0}>{r.days < 0 ? m.study_overdue() : `${r.days}${m.study_days_suffix()}`}</span>
                </span>
                <span class="bar"><span class="fill" style={`width:${r.pct * 100}%`}></span></span>
                <span class="ssub">{r.done}/{r.total} {m.study_done_label()}</span>
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if workServices.length}
    <div class="block">
      <h3>{m.sidebar_services()}</h3>
      <ul>
        {#each workServices as [s, count]}
          {@const meta = categoryMeta(s, $config)}
          <li>
            <a href={`/service/${encodeURIComponent(s)}`} style={`--svc:${meta.color}`}>
              <span class="ico"><Icon name={meta.icon} size={15} /></span>
              <span class="lbl">{meta.label}</span>
              <span class="count">{count}</span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if personalApps.length}
    <div class="block">
      <h3>{m.sidebar_apps()}</h3>
      <ul>
        {#each personalApps as [s, count]}
          {@const meta = categoryMeta(s, $config)}
          <li>
            <a href={`/service/${encodeURIComponent(s)}`} style={`--svc:${meta.color}`}>
              <span class="ico"><Icon name={meta.icon} size={15} /></span>
              <span class="lbl">{meta.label}</span>
              <span class="count">{count}</span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if tags.length}
    <div class="block">
      <h3>{m.sidebar_tags()}</h3>
      <ul>
        {#each tags as [tag, count]}
          <li><a href={`/tag/${encodeURIComponent(tag)}`}><Icon name={tagIcon(tag)} size={14} /><span class="lbl">#{tag}</span><span class="count">{count}</span></a></li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="footer">
    <a class="settings-link" href="/settings" class:active={curPath === '/settings'}>
      <Icon name="gear" size={14} /><span>{m.settings_title()}</span>
    </a>
  </div>
</aside>

<style>
  aside { background: var(--bg-glass); border-right: 1px solid var(--border-glass); padding: 16px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }
  .logo { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 9px; text-decoration: none; padding: 2px; border-radius: 8px; align-self: flex-start; }
  .logo:hover .logo-mark { transform: rotate(-12deg) scale(1.08); }
  .logo-mark { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 9px; color: var(--accent); background: var(--accent-dim); border: 1px solid var(--accent-border); transition: transform 0.18s ease; }
  .logo-text { display: flex; flex-direction: column; line-height: 0.95; font-family: 'Syne', system-ui, sans-serif; }
  .logo-text .l1 { font-size: 12px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: var(--text-muted); }
  .logo-text .l2 { font-size: 20px; font-weight: 800; letter-spacing: 0.01em; background: linear-gradient(95deg, var(--accent), #f0abfc); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .stats a { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--text-secondary); padding: 4px 8px; margin: 0 -8px; border-radius: 6px; text-decoration: none; }
  .stats a:hover { background: var(--bg-glass-hover); color: var(--text-primary); }
  .stats a.active { background: var(--accent-dim); color: var(--accent); }
  .stats a.active b { color: var(--accent); }
  .stats b { color: var(--text-primary); }
  .block h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 6px; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 2px; }
  li a { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; font-size: 12px; text-decoration: none; color: var(--text-secondary); }
  li a:hover { background: var(--bg-glass-hover); }
  li a.active { background: var(--accent-dim); color: var(--accent); }
  li a .ico { color: var(--svc, inherit); display: inline-flex; align-items: center; }
  li a .lbl { flex: 1; color: var(--svc, inherit); }
  li a .count { color: var(--text-muted); font-size: 11px; }
  /* Materie (subjects): icon + name/countdown + a thin progress bar. */
  .subj li a { align-items: flex-start; padding: 5px 6px; }
  .subj .ico { margin-top: 1px; }
  .subj .sbody { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
  .subj .stop { display: flex; align-items: baseline; gap: 6px; }
  .subj .lbl { flex: 1; color: var(--svc, inherit); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .subj .cd { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .subj .cd.soon { color: var(--amber, #e0a458); }
  .subj .cd.over { color: var(--red, #e06c6c); }
  .subj .bar { height: 4px; border-radius: 3px; background: var(--bg-glass-hover); overflow: hidden; }
  .subj .bar .fill { display: block; height: 100%; background: var(--svc, var(--accent)); border-radius: 3px; }
  .subj .ssub { font-size: 10px; color: var(--text-muted); }
  .footer { margin-top: auto; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border-glass); padding-top: 10px; }
  .settings-link { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 6px; font-size: 12px; text-decoration: none; color: var(--text-secondary); }
  .settings-link:hover { background: var(--bg-glass-hover); color: var(--text-primary); }
  .settings-link.active { color: var(--accent); }
</style>
