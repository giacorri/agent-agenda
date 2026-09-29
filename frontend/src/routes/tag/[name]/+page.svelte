<script lang="ts">
  import { page } from '$app/state';
  import { tasks } from '$lib/stores/tasks';
  import TaskCard from '$lib/components/TaskCard.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import * as m from '$lib/paraglide/messages';
  import { tagIcon } from '$lib/services';
  import { isOpen, isOverdue } from '$lib/time';
  import { scopeFilter } from '$lib/stores/scope';
  import { searchFilter, searchActive, query } from '$lib/stores/search';
  import type { Task } from '$lib/types';

  const tagName = $derived(decodeURIComponent(page.params.name));

  const matched = $derived($tasks.filter((t: Task) => $scopeFilter(t) && $searchFilter(t) && t.tags.includes(tagName)));
  const pending = $derived(matched.filter(t => isOpen(t) && !isOverdue(t)).sort(byDue));
  const done = $derived(matched.filter(t => t.status === 'done').sort(byDueDesc));
  const missed = $derived(matched.filter(isOverdue).sort(byDueDesc));

  function byDue(a: Task, b: Task) { if (!a.due_at) return b.due_at ? 1 : 0; if (!b.due_at) return -1; return a.due_at.localeCompare(b.due_at); }
  function byDueDesc(a: Task, b: Task) { return b.due_at.localeCompare(a.due_at); }
</script>

<div class="tag-view">
  <header>
    <a href="/" class="back">{m.back_agenda()}</a>
    <h1><Icon name={tagIcon(tagName)} size={28} /> #{tagName}</h1>
    <span class="count">{matched.length} {m.label_tasks()}</span>
  </header>

  {#if matched.length === 0}
    <p class="empty">{$searchActive ? m.search_none({ q: $query }) : m.view_no_tasks_tag({ name: tagName })}</p>
  {:else}
    {#if missed.length}
      <section class="late">
        <h2>{m.view_missed()}</h2>
        <div class="list">
          {#each missed as t (t.id)}<TaskCard task={t} />{/each}
        </div>
      </section>
    {/if}
    {#if pending.length}
      <section>
        <h2>{m.view_open()}</h2>
        <div class="list">
          {#each pending as t (t.id)}<TaskCard task={t} />{/each}
        </div>
      </section>
    {/if}
    {#if done.length}
      <section>
        <h2>{m.view_memory()}</h2>
        <p class="hint">{m.view_tag_history({ name: tagName })}</p>
        <div class="list">
          {#each done as t (t.id)}<TaskCard task={t} compact />{/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .tag-view { display: flex; flex-direction: column; gap: 24px; overflow-y: auto; padding-right: 8px; }
  header { display: flex; align-items: baseline; gap: 16px; }
  .back { color: var(--link); text-decoration: none; font-size: 13px; }
  .back:hover { color: var(--link-hover); }
  h1 { font-size: 30px; color: var(--accent); display: flex; align-items: center; gap: 12px; }
  .count { color: var(--text-muted); font-size: 13px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 6px; }
  section.late h2 { color: var(--red); display: flex; align-items: center; gap: 7px; }
  section.late h2::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--red); }
  .hint { color: var(--text-muted); font-size: 12px; margin-bottom: 8px; }
  .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; align-items: start; }
  .empty { color: var(--text-muted); }
</style>
