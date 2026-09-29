<script lang="ts">
  import { tasks } from '$lib/stores/tasks';
  import { scopeFilter } from '$lib/stores/scope';
  import { searchFilter } from '$lib/stores/search';
  import { fmtDayShort, fmtDayMonthLong } from '$lib/format';
  import TaskCard from './TaskCard.svelte';
  import type { Task } from '$lib/types';

  function startOfWeek(d: Date): Date {
    const x = new Date(d); const dow = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - dow); x.setHours(0, 0, 0, 0);
    return x;
  }

  let weekStart = $state(startOfWeek(new Date()));

  const days = $derived(Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d;
  }));

  const fmtDay = (d: Date) => fmtDayShort(d);
  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const byDay = (day: Date) => $tasks.filter((t: Task) => $scopeFilter(t) && $searchFilter(t) && isSameDay(new Date(t.due_at), day))
                                       .sort((a, b) => a.due_at.localeCompare(b.due_at));

  function shift(n: number) {
    const d = new Date(weekStart); d.setDate(d.getDate() + n * 7); weekStart = d;
  }
</script>

<div class="week">
  <div class="nav">
    <button onclick={() => shift(-1)}>‹</button>
    <span>{fmtDayMonthLong(weekStart)}</span>
    <button onclick={() => shift(1)}>›</button>
  </div>
  <div class="grid">
    {#each days as d (d.toISOString())}
      <div class="col">
        <h3 class:today={isSameDay(d, new Date())}>{fmtDay(d)}</h3>
        <div class="cards">
          {#each byDay(d) as t (t.id)}
            <TaskCard task={t} compact dense />
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .week { display: flex; flex-direction: column; gap: 10px; overflow: hidden; height: 100%; }
  .nav { display: flex; align-items: center; gap: 12px; }
  .nav button { background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 4px 10px; border-radius: 4px; cursor: pointer; }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; overflow-y: auto; flex: 1; }
  .col { display: flex; flex-direction: column; gap: 5px; min-height: 0; }
  h3 { font-size: 11px; text-transform: uppercase; color: var(--text-muted); position: sticky; top: 0; background: var(--bg-base, #0f0f1a); padding: 2px 0; z-index: 1; }
  h3.today { color: var(--accent); }
  .cards { display: flex; flex-direction: column; gap: 5px; }

  /* Week columns are ~1/7 wide: shrink the cards' type and spacing so they read fuller. */
  .week :global(.card) { padding: 7px 8px; gap: 4px; border-left-width: 2px; }
  .week :global(.card .head) { font-size: 11px; padding-right: 18px; }
  .week :global(.card .when) { font-size: 11px; }
  .week :global(.card .title) { font-size: 12.5px; line-height: 1.25; }
  .week :global(.card .summary) { font-size: 11px; line-height: 1.35; -webkit-line-clamp: 3; line-clamp: 3; }
  .week :global(.card .chips) { gap: 4px; margin-top: 2px; }
  .week :global(.card .chip) { font-size: 10px; padding: 1px 6px; gap: 3px; }
  .week :global(.card .chip .lbl) { display: none; }
  .week :global(.card .req) { font-size: 10px; max-width: 84px; padding: 1px 5px; }
  .week :global(.card .laststep) { padding: 5px 7px; gap: 6px; }
  .week :global(.card .ls-head) { font-size: 11px; line-height: 1.3; }
  .week :global(.card .ls-body) { font-size: 10.5px; line-height: 1.3; }
  .week :global(.card .ls-meta) { font-size: 10px; }
  .week :global(.card .del) { top: 6px; right: 6px; }
</style>
