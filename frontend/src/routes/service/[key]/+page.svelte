<script lang="ts">
  import { page } from '$app/state';
  import { tasks } from '$lib/stores/tasks';
  import { config, categoryMeta } from '$lib/stores/config';
  import { isOpen, isOverdue } from '$lib/time';
  import { scopeFilter } from '$lib/stores/scope';
  import { searchFilter, searchActive, query } from '$lib/stores/search';
  import { subjectsOf } from '$lib/study';
  import TaskCard from '$lib/components/TaskCard.svelte';
  import SubjectTimeline from '$lib/components/SubjectTimeline.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import * as m from '$lib/paraglide/messages';
  import type { Task } from '$lib/types';

  const key = $derived(decodeURIComponent(page.params.key));
  const meta = $derived(categoryMeta(key, $config));
  const isSubject = $derived(subjectsOf($config).some(s => s.key === key));

  // Subjects (exams) open straight into the timeline; the branch below falls back to
  // the list for non-subject services regardless of this default.
  let view = $state<'list' | 'timeline'>('timeline');

  const matched = $derived(($tasks as Task[]).filter(t => $scopeFilter(t) && $searchFilter(t) && t.services.includes(key)));
  const open = $derived(matched.filter(t => isOpen(t) && !isOverdue(t)).sort(byDue));
  const done = $derived(matched.filter(t => t.status === 'done').sort(byDueDesc));
  const missed = $derived(matched.filter(isOverdue).sort(byDueDesc));

  function byDue(a: Task, b: Task) { if (!a.due_at) return b.due_at ? 1 : 0; if (!b.due_at) return -1; return a.due_at.localeCompare(b.due_at); }
  function byDueDesc(a: Task, b: Task) { return b.due_at.localeCompare(a.due_at); }
</script>

<div class="view">
  <header>
    <a href="/" class="back">{m.back_agenda()}</a>
    <h1 style={`--svc:${meta.color}`}><Icon name={meta.icon} size={30} /> {meta.label}</h1>
    <span class="count">{matched.length} {m.label_tasks()}</span>
    {#if isSubject && matched.length && !$searchActive}
      <div class="seg" role="group">
        <button class:on={view === 'list'} onclick={() => (view = 'list')}><Icon name="rows" size={14} /> {m.view_list()}</button>
        <button class:on={view === 'timeline'} onclick={() => (view = 'timeline')}><Icon name="chart" size={14} /> {m.view_timeline()}</button>
      </div>
    {/if}
  </header>

  {#if matched.length === 0}
    <p class="empty">{$searchActive ? m.search_none({ q: $query }) : m.view_no_tasks_service({ name: meta.label })}</p>
  {:else if isSubject && view === 'timeline' && !$searchActive}
    <!-- The `!$searchActive` guard sends a subject to the list while a query is on:
         a search wants the matching topics, not the exam's progress chart. -->
    <SubjectTimeline subjectKey={key} />
  {:else}
    {#if missed.length}
      <section class="late">
        <h2>{m.view_missed()}</h2>
        <div class="list">
          {#each missed as t (t.id)}<TaskCard task={t} />{/each}
        </div>
      </section>
    {/if}
    {#if open.length}
      <section>
        <h2>{m.view_open()}</h2>
        <div class="list">
          {#each open as t (t.id)}<TaskCard task={t} />{/each}
        </div>
      </section>
    {/if}
    {#if done.length}
      <section>
        <h2>{m.view_memory()}</h2>
        <p class="hint">{m.view_memory_hint({ name: meta.label })}</p>
        <div class="list">
          {#each done as t (t.id)}<TaskCard task={t} compact />{/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .view { display: flex; flex-direction: column; gap: 24px; overflow-y: auto; padding-right: 8px; }
  header { display: flex; align-items: baseline; gap: 16px; }
  .seg { margin-left: auto; display: inline-flex; align-self: center; border: 1px solid var(--border-glass); border-radius: 7px; overflow: hidden; }
  .seg button { display: inline-flex; align-items: center; gap: 5px; background: var(--bg-glass); border: none; color: var(--text-secondary); padding: 5px 11px; font-size: 12.5px; cursor: pointer; border-right: 1px solid var(--border-glass); }
  .seg button:last-child { border-right: none; }
  .seg button:hover { background: var(--bg-glass-hover); }
  .seg button.on { background: var(--accent-dim); color: var(--accent); font-weight: 600; }
  .back { color: var(--link); text-decoration: none; font-size: 13px; }
  .back:hover { color: var(--link-hover); }
  h1 { font-size: 30px; color: var(--svc, var(--accent)); display: flex; align-items: center; gap: 12px; }
  .count { color: var(--text-muted); font-size: 13px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 6px; }
  section.late h2 { color: var(--red); display: flex; align-items: center; gap: 7px; }
  section.late h2::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--red); }
  .hint { color: var(--text-muted); font-size: 12px; margin-bottom: 8px; }
  .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; align-items: start; }
  .empty { color: var(--text-muted); }
</style>
