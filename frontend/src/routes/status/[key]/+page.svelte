<script lang="ts">
  import { page } from '$app/state';
  import { tasks } from '$lib/stores/tasks';
  import { scopeFilter } from '$lib/stores/scope';
  import { searchFilter, searchActive, query } from '$lib/stores/search';
  import { isOpen, isOverdue } from '$lib/time';
  import * as m from '$lib/paraglide/messages';
  import TaskCard from '$lib/components/TaskCard.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { Task } from '$lib/types';

  // key = 'open' (open work) or 'done'. Respects the global work/personal scope.
  // 'fatti' is kept as a legacy alias of 'done' so old bookmarks keep working.
  const key = $derived(decodeURIComponent(page.params.key ?? ''));
  const isDone = $derived(key === 'done' || key === 'fatti');
  const title = $derived(isDone ? m.view_done() : m.view_open());
  const icon = $derived(isDone ? 'check' : 'clock');

  const scoped = $derived(($tasks as Task[]).filter((t) => $scopeFilter(t) && $searchFilter(t)));
  const open = $derived(scoped.filter((t) => isOpen(t) && !isOverdue(t)).sort(byDue));
  const overdue = $derived(scoped.filter((t) => isOverdue(t)).sort(byDueDesc));
  const done = $derived(scoped.filter((t) => t.status === 'done').sort(byDueDesc));
  const total = $derived(isDone ? done.length : open.length + overdue.length);

  function byDue(a: Task, b: Task) { if (!a.due_at) return b.due_at ? 1 : 0; if (!b.due_at) return -1; return a.due_at.localeCompare(b.due_at); }
  function byDueDesc(a: Task, b: Task) { return b.due_at.localeCompare(a.due_at); }
</script>

<div class="view">
  <header>
    <a href="/" class="back">{m.back_agenda()}</a>
    <h1><Icon name={icon} size={30} /> {title}</h1>
    <span class="count">{total} {m.label_tasks()}</span>
  </header>

  {#if total === 0}
    <p class="empty">{$searchActive ? m.search_none({ q: $query }) : m.view_nothing_in({ title })}</p>
  {:else if isDone}
    <section>
      <div class="list">
        {#each done as t (t.id)}<TaskCard task={t} compact />{/each}
      </div>
    </section>
  {:else}
    {#if overdue.length}
      <section class="late">
        <h2>{m.dash_late()}</h2>
        <div class="list">
          {#each overdue as t (t.id)}<TaskCard task={t} />{/each}
        </div>
      </section>
    {/if}
    {#if open.length}
      <section>
        <h2>{m.view_scheduled()}</h2>
        <div class="list">
          {#each open as t (t.id)}<TaskCard task={t} />{/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .view { display: flex; flex-direction: column; gap: 24px; overflow-y: auto; padding-right: 8px; }
  header { display: flex; align-items: baseline; gap: 16px; }
  .back { color: var(--link); text-decoration: none; font-size: 13px; }
  .back:hover { color: var(--link-hover); }
  h1 { font-size: 30px; color: var(--accent); display: flex; align-items: center; gap: 12px; }
  .count { color: var(--text-muted); font-size: 13px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 6px; }
  section.late h2 { color: var(--red); display: flex; align-items: center; gap: 7px; }
  section.late h2::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--red); }
  .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; align-items: start; }
  .empty { color: var(--text-muted); }
</style>
