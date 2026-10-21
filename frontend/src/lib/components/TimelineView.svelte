<script lang="ts">
  import { onMount } from 'svelte';
  import { tasks, selectedTaskId } from '$lib/stores/tasks';
  import { scopeFilter } from '$lib/stores/scope';
  import { searchFilter } from '$lib/stores/search';
  import { timelineMode } from '$lib/stores/view';
  import { config, categoryMeta, taskColor, clientFor } from '$lib/stores/config';
  import { fmt, fmtTime, fmtDayMonth, statusLabel } from '$lib/format';
  import { groupByDay, daysLate, type DaySection, type DayItem } from '$lib/timeline';
  import * as m from '$lib/paraglide/messages';
  import type { Task } from '$lib/types';
  import Icon from './Icon.svelte';
  import PeopleStack from './PeopleStack.svelte';
  import ClientLogo from './ClientLogo.svelte';
  import TimelineGantt from './TimelineGantt.svelte';

  const DAYS = 7;
  const DEFAULT_PRIORITY = 2;

  let now = $state(new Date());
  onMount(() => {
    const id = setInterval(() => (now = new Date()), 30_000);
    return () => clearInterval(id);
  });

  const visible = $derived(($tasks as Task[]).filter((t) => $scopeFilter(t) && $searchFilter(t)));
  const groups = $derived(groupByDay(visible, now, DAYS));
  let showUndated = $state(false);

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const weekdayLong = (d: Date) => cap(fmt(d, { weekday: 'long' }));
  const dayMonthLong = (d: Date) => fmt(d, { day: 'numeric', month: 'long' });

  function title(s: DaySection): string {
    switch (s.kind) {
      case 'overdue': return m.tl_overdue();
      case 'today': return m.bucket_today();
      case 'tomorrow': return m.bucket_tomorrow();
      case 'day': return weekdayLong(s.date);
      case 'month': {
        if (s.date.getFullYear() === now.getFullYear() && s.date.getMonth() === now.getMonth()) return m.tl_later_this_month();
        const yr = s.date.getFullYear() !== now.getFullYear() ? ` ${s.date.getFullYear()}` : '';
        return cap(fmt(s.date, { month: 'long' })) + yr;
      }
    }
  }
  function subtitle(s: DaySection): string {
    if (s.kind === 'today' || s.kind === 'tomorrow') return `${weekdayLong(s.date)} ${dayMonthLong(s.date)}`;
    if (s.kind === 'day') return dayMonthLong(s.date);
    return '';
  }

  // Seven-day strip (Todoist-style week navigator): one cell per day with its count.
  const strip = $derived.by(() => {
    const byKey = new Map(groups.sections.map((s) => [s.key, s]));
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { key, date: d, count: byKey.get(key)?.items.length ?? 0, today: i === 0 };
    });
  });
  const overdueCount = $derived(groups.sections.find((s) => s.kind === 'overdue')?.items.length ?? 0);

  let scroller = $state<HTMLElement>();
  function jump(key: string) {
    scroller?.querySelector(`[data-sec="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function open(e: MouseEvent | KeyboardEvent, id: string) {
    if ((e.target as HTMLElement).closest('a')) return;
    selectedTaskId.set(id);
  }

  // Overdue and month sections span several days, so their rows lead with the date.
  function whenParts(it: DayItem, withDate: boolean): { main: string; sub: string } {
    const time = it.due.allDay ? '' : fmtTime(it.due.at);
    return withDate ? { main: fmtDayMonth(it.due.at), sub: time } : { main: time, sub: '' };
  }
  const whoOf = (t: Task) => [...(t.requester ? [t.requester] : []), ...(t.people ?? []).filter((p) => p !== t.requester)];
</script>

<div class="tlv">
  <div class="top">
    <div class="seg" role="group" aria-label={m.tl_mode_label()}>
      <button class:on={$timelineMode === 'days'} aria-pressed={$timelineMode === 'days'} onclick={() => timelineMode.set('days')}>
        <Icon name="rows" size={14} /> {m.tl_mode_days()}
      </button>
      <button class:on={$timelineMode === 'gantt'} aria-pressed={$timelineMode === 'gantt'} onclick={() => timelineMode.set('gantt')}>
        <Icon name="chart" size={14} /> {m.tl_mode_gantt()}
      </button>
    </div>

    {#if $timelineMode === 'days'}
      <nav class="strip" aria-label={m.tl_week_strip()}>
        {#if overdueCount}
          <button class="cell late" onclick={() => jump('overdue')} title={m.tl_overdue()}>
            <span class="wd">{m.tl_overdue()}</span>
            <span class="dn"><Icon name="alert" size={15} /></span>
            <span class="ct">{overdueCount}</span>
          </button>
        {/if}
        {#each strip as c (c.key)}
          <button class="cell" class:today={c.today} class:empty={!c.count} disabled={!c.count}
            onclick={() => jump(c.key)} aria-label={m.tl_jump_to({ day: `${weekdayLong(c.date)} ${dayMonthLong(c.date)}` })}>
            <span class="wd">{fmt(c.date, { weekday: 'short' })}</span>
            <span class="dn">{c.date.getDate()}</span>
            <span class="ct">{c.count || '·'}</span>
          </button>
        {/each}
      </nav>
    {/if}
  </div>

  {#if $timelineMode === 'gantt'}
    <div class="gantt"><TimelineGantt /></div>
  {:else}
    <div class="days" bind:this={scroller}>
      {#each groups.sections as s (s.key)}
        <section class="day glass" class:overdue={s.kind === 'overdue'} class:today={s.kind === 'today'} class:month={s.kind === 'month'} class:empty={!s.items.length} data-sec={s.key}>
          <header>
            <span class="tile">
              {#if s.kind === 'overdue'}
                <Icon name="alert" size={18} />
              {:else if s.kind === 'month'}
                <span class="tw">{fmt(s.date, { month: 'short' })}</span><Icon name="calendar" size={15} />
              {:else}
                <span class="tw">{fmt(s.date, { weekday: 'short' })}</span><span class="tn">{s.date.getDate()}</span>
              {/if}
            </span>
            <span class="hl">
              <b>{title(s)}</b>
              {#if subtitle(s)}<span class="sub">{subtitle(s)}</span>{/if}
              {#if !s.items.length}<span class="none">{m.tl_nothing_today()}</span>{/if}
            </span>
            {#if s.items.length}<span class="count">{s.items.length}</span>{/if}
          </header>

          {#if s.items.length}
            <ul>
              {#each s.items as it (it.task.id)}
                {@render row(it, s.kind === 'overdue', s.kind === 'month')}
              {/each}
            </ul>
          {/if}
        </section>
      {/each}

      {#if groups.sections.length === 1 && groups.sections[0].kind === 'today'}
        <p class="ahead">{m.tl_nothing_ahead()}</p>
      {/if}

      {#if groups.undated.length}
        <section class="undated">
          <button class="und-head" class:open={showUndated} aria-expanded={showUndated} onclick={() => (showUndated = !showUndated)}>
            <Icon name="chevron" size={14} /> {m.tl_no_date()} <span class="und-count">{groups.undated.length}</span>
          </button>
          {#if showUndated}
            <ul class="glass">
              {#each groups.undated as t (t.id)}
                {@render row({ task: t, due: { at: new Date(t.created_at), allDay: true }, late: false }, false, false, true)}
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    </div>
  {/if}
</div>

{#snippet row(it: DayItem, overdueSec: boolean, showDate: boolean, undated = false)}
  {@const t = it.task}
  {@const cats = (t.services ?? []).filter((x) => x && x.trim())}
  {@const who = whoOf(t)}
  {@const blocked = (t.blocked_by ?? []).length > 0}
  {@const w = whenParts(it, overdueSec || showDate)}
  <li>
    <div class="row" role="button" tabindex="0" style={`--c:${taskColor(t, $config)}`}
      class:late={it.late} class:prog={t.status === 'in_progress'} class:snz={t.status === 'snoozed'} class:blocked
      onclick={(e) => open(e, t.id)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e, t.id); } }}>
      <span class="st" title={statusLabel(t.status)} aria-label={statusLabel(t.status)}></span>
      {#if !undated}
        <span class="when" title={it.due.allDay ? m.tl_all_day() : ''}>{w.main}{#if w.sub}<i>{w.sub}</i>{/if}</span>
      {/if}
      <span class="main">
        <span class="title">{t.title}</span>
        <span class="meta">
          {#if !undated && w.main}<span class="when-inline">{w.main}{w.sub ? ` ${w.sub}` : ''}</span>{/if}
          {#if overdueSec}<span class="flag late">{m.tl_days_late({ count: daysLate(it.due, now) })}</span>
          {:else if it.late}<span class="flag late">{m.overdue()}</span>{/if}
          {#if t.status === 'in_progress' || t.status === 'snoozed'}<span class="flag {t.status}">{statusLabel(t.status)}</span>{/if}
          {#if blocked}<span class="flag blocked" title={(t.blocked_by ?? []).map((b) => b.title).join(', ')}><Icon name="lock" size={11} /> {m.tc_blocked()}</span>{/if}
          {#each cats.slice(0, 2) as key (key)}
            {@const meta = categoryMeta(key, $config)}
            <a class="cat" href={`/service/${encodeURIComponent(key)}`} style={`--svc:${meta.color}`} title={meta.label}><Icon name={meta.icon} size={12} /><span>{meta.label}</span></a>
          {/each}
          {#if cats.length > 2}<span class="more">+{cats.length - 2}</span>{/if}
        </span>
      </span>
      <span class="side">
        {#if t.priority !== DEFAULT_PRIORITY}
          {@const high = t.priority < DEFAULT_PRIORITY}
          <span class="prio" class:high title={high ? m.tl_prio_high() : m.tl_prio_low()}>P{t.priority}</span>
        {/if}
        {#if who.length}<PeopleStack names={who} size={20} />{/if}
        {#if t.client}
          {@const cl = clientFor(t.client, $config)}
          <a class="cli" href={`/client/${encodeURIComponent(cl?.key ?? t.client)}`} title={m.tc_for_client({ name: cl?.label ?? t.client })} aria-label={m.tc_for_client({ name: cl?.label ?? t.client })}>
            <ClientLogo logo={cl?.logo} size={cl?.logo ? 18 : 14} alt={cl?.label ?? t.client} />
          </a>
        {/if}
      </span>
    </div>
  </li>
{/snippet}

<style>
  .tlv { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; container-type: inline-size; }

  .top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .seg { display: inline-flex; gap: 2px; padding: 2px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 8px; }
  .seg button { display: inline-flex; align-items: center; gap: 6px; background: none; border: 1px solid transparent; border-radius: 6px; color: var(--text-secondary); padding: 4px 10px; font: inherit; font-size: 13px; cursor: pointer; }
  .seg button:hover { background: var(--bg-glass-hover); color: var(--text-primary); }
  .seg button.on { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }

  /* Week navigator: compact day tiles, today in the accent, empty days quiet. */
  .strip { display: flex; gap: 6px; flex-wrap: wrap; }
  .cell { display: grid; justify-items: center; gap: 0; min-width: 46px; padding: 4px 6px 5px; border-radius: 8px; cursor: pointer;
    background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-secondary); font: inherit; }
  .cell:hover:not(:disabled) { background: var(--bg-glass-hover); color: var(--text-primary); }
  .cell:disabled { cursor: default; opacity: 0.5; }
  .cell .wd { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .cell .dn { font-size: 16px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; display: inline-flex; align-items: center; min-height: 19px; }
  .cell .ct { font-size: 11px; font-weight: 600; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .cell.today { background: var(--accent-dim); border-color: var(--accent-border); }
  .cell.today .dn, .cell.today .wd, .cell.today .ct { color: var(--accent); }
  .cell.late { background: var(--red-dim); border-color: var(--red-border); }
  .cell.late .wd, .cell.late .dn, .cell.late .ct { color: var(--red); }

  .gantt { flex: 1; min-height: 0; display: flex; flex-direction: column; }

  .days { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding-bottom: 24px; }
  .days > * { width: 100%; max-width: 980px; }

  /* clip, not hidden: hidden would make each section a scroll container and break the sticky header. */
  .day { overflow: clip; flex: none; }
  .day header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px; padding: 10px 14px;
    background: color-mix(in srgb, var(--bg-base) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border-glass); }
  .tile { display: grid; justify-items: center; align-content: center; width: 42px; height: 42px; flex: none; border-radius: 8px;
    background: var(--bg-glass-hover); color: var(--text-secondary); }
  .tile .tw { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; line-height: 1.1; color: var(--text-muted); }
  .tile .tn { font-size: 18px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; color: var(--text-primary); }
  .hl { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; flex: 1; }
  .hl b { font-size: 16px; font-weight: 650; color: var(--text-primary); }
  .hl .sub { font-size: 13px; color: var(--text-muted); }
  .count { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; padding: 1px 9px; border-radius: 999px;
    background: var(--bg-glass-hover); color: var(--text-secondary); }

  .day.today { border-color: var(--accent-border); }
  .day.today .tile { background: var(--accent-dim); }
  .day.today .tile .tw, .day.today .tile .tn, .day.today .hl b { color: var(--accent); }
  .day.today .count { background: var(--accent-dim); color: var(--accent); }
  .day.overdue { border-color: var(--red-border); }
  .day.overdue .tile { background: var(--red-dim); color: var(--red); }
  .day.overdue .hl b { color: var(--red); }
  .day.overdue .count { background: var(--red-dim); color: var(--red); }
  .day.month .tile { color: var(--text-muted); }

  .hl .none { font-size: 13px; color: var(--text-muted); font-style: italic; }
  .day.empty header { border-bottom: none; }
  .ahead { font-size: 13px; color: var(--text-muted); padding: 0 4px; }

  ul { list-style: none; }
  li + li .row { border-top: 1px solid color-mix(in srgb, var(--border-glass) 70%, transparent); }

  /* One scannable line per task: status · time · title/meta · people. */
  .row { display: grid; grid-template-columns: 14px 72px minmax(0, 1fr) auto; align-items: center; gap: 12px;
    padding: 9px 14px 9px 12px; border-left: 3px solid var(--c, transparent); cursor: pointer; transition: background 0.12s; }
  .undated .row { grid-template-columns: 14px minmax(0, 1fr) auto; }
  .undated .row .main { padding: 2px 0; }
  .row:hover { background: var(--bg-glass-hover); }
  .row:focus { outline: none; }
  .row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  /* Status glyph: ring = to do, half-filled = in progress, dashed = snoozed, red = late. */
  .st { width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--text-muted); justify-self: center; }
  .row.prog .st { border-color: var(--accent); background: conic-gradient(var(--accent) 0 50%, transparent 50% 100%); }
  .row.snz .st { border-style: dashed; border-color: var(--amber); }
  .row.late .st { border-color: var(--red); }

  .when { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-secondary); white-space: nowrap; display: flex; flex-direction: column; line-height: 1.25; }
  .when i { font-style: normal; font-weight: 500; font-size: 12px; color: var(--text-muted); }
  .row.late .when, .row.late .when-inline { color: var(--red); }
  .when-inline { display: none; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-secondary); white-space: nowrap; }

  .main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .title { font-size: 15px; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
  .meta:empty { display: none; }
  .flag { font-size: 11px; font-weight: 600; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px; }
  .flag.late { color: var(--red); }
  .flag.in_progress { color: var(--accent); }
  .flag.snoozed { color: var(--amber); }
  .flag.blocked { color: var(--amber); }
  .cat { display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border-radius: 999px; text-decoration: none; white-space: nowrap;
    color: var(--svc, var(--accent)); background: color-mix(in srgb, var(--svc, var(--accent)) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--svc, var(--accent)) 32%, transparent); }
  .cat:hover { background: color-mix(in srgb, var(--svc, var(--accent)) 22%, transparent); }
  .more { color: var(--text-muted); }

  .side { display: inline-flex; align-items: center; gap: 8px; }
  .prio { font-size: 11px; font-weight: 700; padding: 0 6px; border-radius: 4px; color: var(--text-muted); border: 1px solid var(--border-glass); }
  .prio.high { color: var(--amber); border-color: var(--amber-border); background: var(--amber-dim); }
  .cli { display: inline-flex; color: var(--text-secondary); text-decoration: none; }

  .undated { flex: none; }
  .und-head { display: flex; align-items: center; gap: 8px; padding: 6px 2px; background: none; border: none; cursor: pointer;
    font: inherit; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  .und-head:hover { color: var(--text-primary); }
  .und-head :global(svg) { transition: transform 0.15s ease; transform: rotate(-90deg); }
  .und-head.open :global(svg) { transform: rotate(0deg); }
  .und-count { opacity: 0.6; font-weight: 500; }
  .undated ul { margin-top: 8px; overflow: hidden; }

  /* Narrow: drop category labels to icons, tighten the time column. */
  @container (max-width: 560px) {
    /* The time column moves into the meta line so the title gets the full width. */
    .row { grid-template-columns: 12px minmax(0, 1fr) auto; gap: 10px; padding: 9px 10px 9px 9px; }
    .row .when { display: none; }
    .when-inline { display: inline; }
    .cat span { display: none; }
    .cat { padding: 1px 5px; }
    .title { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
    .day header { padding: 9px 10px; gap: 10px; }
    .cell { min-width: 38px; padding: 3px 4px 4px; }
  }
</style>
