<script lang="ts">
  import { tasks } from '$lib/stores/tasks';
  import { scopeFilter } from '$lib/stores/scope';
  import { searchFilter } from '$lib/stores/search';
  import { monthLabel as fmtMonthLabel, fmtWeekdayDayMonthLong } from '$lib/format';
  import { getLocale } from '$lib/i18n';
  import * as m from '$lib/paraglide/messages';
  import TaskCard from './TaskCard.svelte';
  import type { Task } from '$lib/types';

  // Locale-aware Mon–Sun weekday headers (the grid is Monday-first).
  const weekdays = $derived.by(() => {
    const fmt = new Intl.DateTimeFormat(getLocale(), { weekday: 'short' });
    // 2024-01-01 is a Monday; walk Mon→Sun.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
  });

  let cursor = $state(new Date());
  let selectedDay = $state<Date | null>(null);

  function startOfMonthGrid(d: Date): Date {
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const dow = (first.getDay() + 6) % 7;
    first.setDate(first.getDate() - dow); first.setHours(0, 0, 0, 0);
    return first;
  }

  const days = $derived(Array.from({ length: 42 }, (_, i) => {
    const d = new Date(startOfMonthGrid(cursor));
    d.setDate(d.getDate() + i); return d;
  }));

  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const inCursorMonth = (d: Date) => d.getMonth() === cursor.getMonth();
  const byDay = (day: Date) => $tasks.filter((t: Task) => $scopeFilter(t) && $searchFilter(t) && isSameDay(new Date(t.due_at), day));

  function shift(n: number) {
    const d = new Date(cursor); d.setMonth(d.getMonth() + n); cursor = d; selectedDay = null;
  }

  const monthLabel = $derived(fmtMonthLabel(cursor));
  const selectedTasks = $derived(selectedDay ? byDay(selectedDay) : []);
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && selectedDay) selectedDay = null; }} />

<div class="month">
  <div class="nav">
    <button onclick={() => shift(-1)}>‹</button>
    <span>{monthLabel}</span>
    <button onclick={() => shift(1)}>›</button>
  </div>
  <div class="grid">
    {#each weekdays as label}
      <div class="dow">{label}</div>
    {/each}
    {#each days as d (d.toISOString())}
      {@const items = byDay(d)}
      <button class="day" class:other={!inCursorMonth(d)}
              class:today={isSameDay(d, new Date())}
              onclick={() => selectedDay = d}>
        <span class="dnum">{d.getDate()}</span>
        {#if items.length}
          <span class="dots">
            {#each items.slice(0, 3) as _t}<span class="dot"></span>{/each}
            {#if items.length > 3}<span class="more">+{items.length - 3}</span>{/if}
          </span>
        {/if}
      </button>
    {/each}
  </div>
  {#if selectedDay && selectedTasks.length}
    <aside class="drawer glass">
      <header>
        <b>{fmtWeekdayDayMonthLong(selectedDay)}</b>
        <button onclick={() => selectedDay = null} aria-label={m.td_close()}>×</button>
      </header>
      <div class="dlist">
        {#each selectedTasks as t (t.id)}<TaskCard task={t} />{/each}
      </div>
    </aside>
  {/if}
</div>

<style>
  .month { display: flex; flex-direction: column; gap: 12px; height: 100%; }
  .nav { display: flex; gap: 12px; align-items: center; text-transform: capitalize; }
  .nav button { background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 4px 10px; border-radius: 4px; cursor: pointer; }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; flex: 1; }
  .dow { font-size: 11px; text-transform: uppercase; color: var(--text-muted); text-align: center; }
  .day { background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-primary); border-radius: 6px; padding: 6px; display: flex; flex-direction: column; gap: 4px; cursor: pointer; min-height: 60px; align-items: stretch; text-align: left; }
  .day.other { opacity: 0.4; }
  .day.today { border-color: var(--accent-border); }
  .day:hover { background: var(--bg-glass-hover); }
  .dnum { font-size: 12px; color: var(--text-secondary); }
  .dots { display: flex; gap: 3px; align-items: center; }
  .dot { width: 6px; height: 6px; background: var(--accent); border-radius: 50%; }
  .more { font-size: 10px; color: var(--text-muted); }
  .drawer { padding: 12px; display: flex; flex-direction: column; gap: 8px; max-height: 320px; }
  .drawer header { display: flex; justify-content: space-between; align-items: center; }
  .drawer header button { background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px; }
  .dlist { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
</style>
