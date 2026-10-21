<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { selectedTaskId } from '$lib/stores/tasks';
  import { activeScopeIsHidden } from '$lib/stores/scope';
  import { ganttZoom, ganttShowClosed, ganttLabelWidth, GANTT_LABEL_MIN, GANTT_LABEL_MAX } from '$lib/stores/view';
  import { config, categoryMeta, taskColor, taskRepo } from '$lib/stores/config';
  import { renderMarkdown } from '$lib/markdown';
  import { fmt, fmtTime, fmtDayMonth, fmtDueFull, fmtDateTime, statusLabel } from '$lib/format';
  import { relativeTime } from '$lib/time';
  import { daysLate, type DayGroups, type DaySection, type DayItem } from '$lib/timeline';
  import {
    ZOOMS, ZOOM_SPEC, ganttRange, initialScrollDay, markFor, axisFor, dayCells, dayPos, closedRows,
    type Zoom, type Mark, type Range,
  } from '$lib/gantt';
  import type { Due } from '$lib/due';
  import * as m from '$lib/paraglide/messages';
  import type { Task } from '$lib/types';
  import Icon from './Icon.svelte';
  import PeopleStack from './PeopleStack.svelte';

  // Rows and sections come from the same grouping as the By day list, so both modes
  // always agree on where a task sits; `tasks` (already scope/search filtered) feeds
  // the optional closed group.
  let { groups, tasks, now, sectionTitle, sectionSub }: {
    groups: DayGroups; tasks: Task[]; now: Date;
    sectionTitle: (s: DaySection) => string; sectionSub: (s: DaySection) => string;
  } = $props();

  const DEFAULT_PRIORITY = 2;
  const ROW_H = 40;
  const NARROW = 640;

  const ZOOM_LABEL: Record<Zoom, () => string> = {
    day: m.gantt_zoom_day, week: m.gantt_zoom_week, month: m.gantt_zoom_month, quarter: m.gantt_zoom_quarter,
  };

  let width = $state(1200);
  const narrow = $derived(width < NARROW);
  const labelW = $derived(narrow ? 128 : $ganttLabelWidth);
  const px = $derived(ZOOM_SPEC[$ganttZoom].px * (narrow ? 0.8 : 1));
  let expanded = $state(false);
  let showUndated = $state(false);

  interface Row { task: Task; due: Due; mark: Mark; }
  interface Group { key: string; kind: DaySection['kind'] | 'closed'; title: string; sub: string; rows: Row[]; }

  const isClosedTask = (t: Task) => t.status === 'done' || t.status === 'shelved';
  const closedCount = $derived(tasks.filter(isClosedTask).length);

  // Closed tasks don't widen the axis: they are context, shown when they fall inside it.
  const range = $derived.by<Range>(() =>
    ganttRange(groups.sections.flatMap((s) => s.items.map((it) => it.due.at)), now, $ganttZoom));

  const rowsOf = (items: DayItem[]): Row[] =>
    items.map((it) => ({ task: it.task, due: it.due, mark: markFor(it.task, it.due, range, now) }));

  const view = $derived.by<Group[]>(() => {
    const out: Group[] = groups.sections.map((s) => ({
      key: s.key, kind: s.kind, title: sectionTitle(s), sub: sectionSub(s), rows: rowsOf(s.items),
    }));
    if ($ganttShowClosed) {
      const rows = closedRows(tasks, range).map(({ task, due }) => ({ task, due, mark: markFor(task, due, range, now) }));
      if (rows.length) out.push({ key: 'closed', kind: 'closed', title: m.bucket_closed(), sub: '', rows });
    }
    return out;
  });
  const openCount = $derived(groups.sections.reduce((n, s) => n + s.items.length, 0));

  const axis = $derived(axisFor(range, $ganttZoom));
  const days = $derived(dayCells(range));
  const trackW = $derived(Math.ceil(range.days * px));
  const nowX = $derived(dayPos(range.start, now) * px);

  // ---- labels -------------------------------------------------------------
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  function topLabel(d: Date): string {
    if ($ganttZoom === 'quarter') return String(d.getFullYear());
    const yr = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
    return cap(fmt(d, { month: $ganttZoom === 'month' ? 'short' : 'long' })) + yr;
  }
  function bottomLabel(d: Date): string {
    if (axis.unit === 'month') return cap(fmt(d, { month: 'short' }));
    if ($ganttZoom === 'week') return fmt(d, { day: 'numeric', month: 'short' });
    return String(d.getDate());
  }
  const weekdayShort = (d: Date) => fmt(d, { weekday: 'short' }).replace('.', '');

  // ---- scrolling ------------------------------------------------------------
  let scroller = $state<HTMLElement>();
  let scrollX = $state(0);
  let viewW = $state(0);
  // Visible stretch of the lanes, in lane pixels: what scrolled under the sticky
  // task column is hidden.
  const laneView = $derived({ from: scrollX, to: scrollX + Math.max(viewW - labelW, 0) });
  // Marker fully outside the visible lanes → which edge to point to (Notion-style hint).
  function offside(mk: Mark): 'left' | 'right' | null {
    const pad = mk.shape === 'point' ? 7 : 0;
    const x0 = mk.at * px - pad, x1 = (mk.at + mk.span) * px + pad;
    if (x1 < laneView.from + 4) return 'left';
    if (x0 > laneView.to - 4) return 'right';
    return null;
  }
  function scrollToToday(smooth = false) {
    scroller?.scrollTo({ left: initialScrollDay(range, $ganttZoom) * px, behavior: smooth ? 'smooth' : 'auto' });
  }
  // Re-place on today when the view opens, the zoom changes or the axis start moves
  // (data arrived, a task slipped), not on every refresh: that would yank the view
  // away while the person is scrolling.
  let placedFor = '';
  $effect(() => {
    const key = `${$ganttZoom}|${narrow}|${range.start.getTime()}`;
    if (key === placedFor || !scroller) return;
    placedFor = key;
    tick().then(() => scrollToToday());
  });

  // ---- task column resize ------------------------------------------------------
  const clampW = (w: number) => Math.round(Math.min(GANTT_LABEL_MAX, Math.max(GANTT_LABEL_MIN, w)));
  function startResize(e: PointerEvent) {
    e.preventDefault();
    const x0 = e.clientX, w0 = $ganttLabelWidth;
    const move = (ev: PointerEvent) => ganttLabelWidth.set(clampW(w0 + ev.clientX - x0));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function resizeKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0;
    if (!step) return;
    e.preventDefault();
    ganttLabelWidth.update((w) => clampW(w + step));
  }

  // ---- hover card ---------------------------------------------------------------
  let tip = $state<{ row: Row; x: number; y: number } | null>(null);
  function hover(e: PointerEvent, row: Row) {
    if (e.pointerType === 'touch') return;
    tip = { row, x: e.clientX, y: e.clientY };
  }
  const tipStyle = $derived.by(() => {
    if (!tip) return '';
    const W = 300, H = 170;
    const left = Math.min(tip.x + 16, window.innerWidth - W - 8);
    const top = tip.y + 18 + H > window.innerHeight ? tip.y - H - 10 : tip.y + 18;
    return `left:${Math.max(8, left)}px; top:${Math.max(8, top)}px`;
  });

  function open(e: MouseEvent | KeyboardEvent, id: string) {
    if ((e.target as HTMLElement).closest('a')) return;
    selectedTaskId.set(id);
  }
  const whoOf = (t: Task) => [...(t.requester ? [t.requester] : []), ...(t.people ?? []).filter((p) => p !== t.requester)];

  // The inline label starts after the marker, or after the late stretch.
  function labelX(mk: Mark): number {
    const end = mk.late ? mk.late.to : mk.shape === 'day' ? mk.at + 1 : mk.at;
    return end * px + (mk.shape === 'point' && !mk.late ? 12 : 8);
  }
  // Due earlier today reads "overdue", not "0d late".
  const lateText = (r: Row) => {
    const n = daysLate(r.due, now);
    return n > 0 ? m.tl_days_late({ count: n }) : m.overdue();
  };

  onMount(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && expanded) expanded = false; };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  });
</script>

<div class="gantt" class:expanded class:narrow bind:clientWidth={width}
  style={`--lw:${labelW}px; --tw:${trackW}px; --row:${ROW_H}px`}>
  <div class="toolbar" role="toolbar" aria-label={m.gantt_toolbar()}>
    <div class="seg" role="group" aria-label={m.gantt_zoom_label()}>
      {#each ZOOMS as z (z)}
        <button class:on={$ganttZoom === z} aria-pressed={$ganttZoom === z} onclick={() => ganttZoom.set(z)}>{ZOOM_LABEL[z]()}</button>
      {/each}
    </div>
    <button class="btn" onclick={() => scrollToToday(true)} title={m.gantt_today_title()}>
      <Icon name="calendar" size={14} /> {m.gantt_today()}
    </button>
    <button class="btn toggle" class:on={$ganttShowClosed} aria-pressed={$ganttShowClosed}
      onclick={() => ganttShowClosed.update((v) => !v)} title={m.gantt_show_closed_title()}>
      <span class="box">{#if $ganttShowClosed}<Icon name="check" size={11} />{/if}</span>
      {m.gantt_show_closed()} <span class="n">{closedCount}</span>
    </button>
    {#if !narrow}
      <button class="btn" onclick={() => (expanded = !expanded)} title={m.tl_expand()}>
        <Icon name="expand" size={14} /> {expanded ? m.tl_collapse() : m.tl_expand_label()}
      </button>
    {/if}
    <div class="legend" aria-hidden="true">
      <span><i class="lg-day"></i>{m.gantt_legend_all_day()}</span>
      <span><i class="lg-point"></i>{m.gantt_legend_timed()}</span>
      <span><i class="lg-lead"></i>{m.gantt_legend_waiting()}</span>
      <span><i class="lg-late"></i>{m.gantt_legend_late()}</span>
    </div>
  </div>

  <div class="chart" bind:this={scroller} bind:clientWidth={viewW} onscroll={(e) => { tip = null; scrollX = e.currentTarget.scrollLeft; }}>
    <div class="canvas">
      <!-- Two-tier header: a coarse row (months / years) over a fine row (days / weeks / months). -->
      <div class="head">
        <div class="corner">
          <span>{m.tl_task_header()}</span>
          {#if !narrow}
            <!-- Drag to resize; arrow keys resize too when focused. -->
            <button type="button" class="grip" aria-label={m.gantt_resize()} title={m.gantt_resize()}
              onpointerdown={startResize} onkeydown={resizeKey}></button>
          {/if}
        </div>
        <div class="tiers">
          <div class="tier top">
            {#each axis.top as c (c.from)}
              <span class="cell" class:tight={c.span * px < 44} style={`left:${c.from * px}px; width:${c.span * px}px`}><b>{topLabel(c.date)}</b></span>
            {/each}
          </div>
          <div class="tier bottom" class:days={axis.unit === 'day'}>
            {#if axis.unit === 'day'}
              {#each days as d (d.from)}
                <span class="cell day" class:weekend={d.weekend} class:today={d.today} style={`left:${d.from * px}px; width:${px}px`}>
                  <i>{weekdayShort(d.date)}</i><b>{d.date.getDate()}</b>
                </span>
              {/each}
            {:else}
              {#each axis.bottom as c (c.from)}
                <span class="cell" class:tight={c.span * px < 30} class:today={range.today >= c.from && range.today < c.from + c.span}
                  style={`left:${c.from * px}px; width:${c.span * px}px`}><b>{bottomLabel(c.date)}</b></span>
              {/each}
            {/if}
          </div>
        </div>
      </div>

      <div class="body">
        <div class="bg" aria-hidden="true">
          {#if px >= 4}
            {#each days as d (d.from)}
              {#if d.weekend}<span class="wkend" style={`left:${d.from * px}px; width:${px}px`}></span>{/if}
            {/each}
          {/if}
          {#each axis.lines as x (x)}<span class="line" style={`left:${x * px}px`}></span>{/each}
          <span class="todaycol" style={`left:${range.today * px}px; width:${Math.max(px, 2)}px`}></span>
          <span class="now" style={`left:${nowX}px`}></span>
        </div>

        {#each view as g (g.key)}
          <div class="ghead {g.kind}">
            <span class="gt"><b>{g.title}</b>{#if g.sub && !narrow}<span class="gs">{g.sub}</span>{/if}<span class="gc">{g.rows.length}</span></span>
          </div>
          {#each g.rows as r (r.task.id)}
            {@render row(r)}
          {/each}
          {#if !g.rows.length}
            <div class="emptyrow"><span>{m.tl_nothing_today()}</span></div>
          {/if}
        {/each}

        {#if groups.undated.length}
          <div class="ghead undated">
            <button class="gt und" class:open={showUndated} aria-expanded={showUndated} onclick={() => (showUndated = !showUndated)}>
              <Icon name="chevron" size={13} /><b>{m.tl_no_date()}</b><span class="gc">{groups.undated.length}</span>
            </button>
          </div>
          {#if showUndated}
            {#each groups.undated as t (t.id)}
              {@render labelOnly(t)}
            {/each}
          {/if}
        {/if}
      </div>
    </div>
  </div>

  {#if openCount === 0}
    <p class="empty">{$activeScopeIsHidden ? m.tl_nothing_ahead() : m.gantt_nothing()}</p>
  {/if}

  {#if tip}
    {@const t = tip.row.task}
    {@const mk = tip.row.mark}
    <div class="tip" style={tipStyle} role="tooltip">
      <b class="tt">{t.title}</b>
      {#if t.summary}<div class="ts md">{@html renderMarkdown(t.summary, taskRepo(t), $config)}</div>{/if}
      <dl>
        <dt>{m.gantt_tip_due()}</dt>
        <dd>{t.due_at ? fmtDueFull(t.due_at) : m.tl_no_date()}</dd>
        <dt>{m.gantt_tip_status()}</dt>
        <dd class={mk.kind}>{statusLabel(t.status)}{#if mk.kind === 'late'} · {lateText(tip.row)}{/if}</dd>
        {#if t.completed_at && isClosedTask(t)}
          <dt>{m.gantt_tip_completed()}</dt><dd>{fmtDateTime(t.completed_at)}</dd>
        {:else}
          <dt>{m.gantt_tip_created()}</dt><dd>{fmtDateTime(t.created_at)} · {relativeTime(t.created_at, now)}</dd>
        {/if}
      </dl>
    </div>
  {/if}
</div>

{#snippet rowLabel(t: Task)}
  {@const who = whoOf(t)}
  {@const cats = (t.services ?? []).filter((x) => x && x.trim())}
  <span class="st" title={statusLabel(t.status)}></span>
  <span class="ti">{t.title}</span>
  {#if !narrow}
    <span class="side">
      {#if cats.length && labelW >= 260}
        {@const meta = categoryMeta(cats[0], $config)}
        <span class="cat" style={`--svc:${meta.color}`} title={meta.label}><Icon name={meta.icon} size={12} /></span>
      {/if}
      {#if t.priority !== DEFAULT_PRIORITY}
        <span class="prio" class:high={t.priority < DEFAULT_PRIORITY} title={t.priority < DEFAULT_PRIORITY ? m.tl_prio_high() : m.tl_prio_low()}>P{t.priority}</span>
      {/if}
      {#if who.length && labelW >= 240}<PeopleStack names={who.slice(0, 3)} size={18} />{/if}
    </span>
  {/if}
{/snippet}

{#snippet row(r: Row)}
  {@const t = r.task}
  {@const mk = r.mark}
  {@const side = offside(mk)}
  <div class="row {mk.kind}" role="button" tabindex="0" style={`--c:${taskColor(t, $config)}`}
    class:blocked={(t.blocked_by ?? []).length > 0}
    onclick={(e) => open(e, t.id)}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e, t.id); } }}
    onpointermove={(e) => hover(e, r)} onpointerleave={() => (tip = null)}>
    <div class="label">{@render rowLabel(t)}</div>
    <div class="lane">
      {#if mk.leadFrom !== null}
        <span class="lead" style={`left:${mk.leadFrom * px}px; width:${(mk.at - mk.leadFrom) * px}px`}></span>
      {/if}
      {#if mk.late}
        <span class="latebar" style={`left:${mk.late.from * px}px; width:${(mk.late.to - mk.late.from) * px}px`}></span>
      {/if}
      {#if mk.shape === 'day'}
        {@const w = Math.max(px - 6, 8)}
        <span class="mk day" style={`left:${mk.at * px + (px - w) / 2}px; width:${w}px`}>
          {#if mk.kind === 'done'}<Icon name="check" size={11} />{/if}
        </span>
      {:else}
        <span class="mk point" style={`left:${mk.at * px}px`}>
          {#if mk.kind === 'done'}<Icon name="check" size={10} />{/if}
        </span>
      {/if}
      {#if side === 'left'}
        <span class="off left" class:late={mk.kind === 'late'} style={`left:${laneView.from + 6}px`}><Icon name="chevron" size={11} />{fmtDayMonth(r.due.at)}</span>
      {:else if side === 'right'}
        <span class="off right" style={`left:${laneView.to - 6}px`}>{fmtDayMonth(r.due.at)}<Icon name="chevron" size={11} /></span>
      {/if}
      <span class="tag" style={`left:${labelX(mk)}px`}>
        {#if mk.kind === 'late'}<em class="late">{lateText(r)}</em>{/if}
        {#if !r.due.allDay && mk.kind !== 'done' && mk.kind !== 'shelved' && mk.kind !== 'late'}<em>{fmtTime(r.due.at)}</em>{/if}
        <span>{t.title}</span>
      </span>
    </div>
  </div>
{/snippet}

{#snippet labelOnly(t: Task)}
  <div class="row undated-row" role="button" tabindex="0" style={`--c:${taskColor(t, $config)}`}
    onclick={(e) => open(e, t.id)}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e, t.id); } }}>
    <div class="label">{@render rowLabel(t)}</div>
    <div class="lane"></div>
  </div>
{/snippet}

<style>
  .gantt { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; }
  .gantt.expanded {
    position: fixed; inset: 0; z-index: 45; padding: 16px;
    background: linear-gradient(135deg, var(--bg-base), var(--bg-deep));
  }

  .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .seg { display: inline-flex; gap: 2px; padding: 2px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 8px; }
  .seg button { background: none; border: 1px solid transparent; border-radius: 6px; color: var(--text-secondary); padding: 3px 10px; font: inherit; font-size: 13px; cursor: pointer; }
  .seg button:hover { background: var(--bg-glass-hover); color: var(--text-primary); }
  .seg button.on { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
  .btn { display: inline-flex; align-items: center; gap: 6px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 8px;
    color: var(--text-secondary); padding: 4px 10px; font: inherit; font-size: 13px; cursor: pointer; }
  .btn:hover { background: var(--bg-glass-hover); color: var(--text-primary); }
  .toggle .box { width: 14px; height: 14px; border-radius: 4px; border: 1.5px solid var(--text-muted); display: inline-grid; place-items: center; }
  .toggle.on { color: var(--text-primary); }
  .toggle.on .box { background: var(--green); border-color: var(--green); color: #06210f; }
  .toggle .n { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }

  .legend { display: flex; gap: 14px; margin-left: auto; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .legend i { display: inline-block; flex: none; }
  .lg-day { width: 14px; height: 12px; border-radius: 3px; background: var(--accent); }
  .lg-point { width: 9px; height: 9px; transform: rotate(45deg); background: var(--accent); border-radius: 2px; }
  .lg-lead { width: 18px; height: 3px; border-radius: 2px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 60%, transparent)); }
  .lg-late { width: 18px; height: 10px; border-radius: 3px; background: var(--red-dim); border: 1px solid var(--red-border); }

  .chart { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border-glass); border-radius: 10px; background: var(--bg-glass); overscroll-behavior-x: contain; }
  .canvas { width: calc(var(--lw) + var(--tw)); min-width: 100%; position: relative; }

  /* ---- header ---- */
  .head { position: sticky; top: 0; z-index: 6; display: grid; grid-template-columns: var(--lw) var(--tw); background: var(--bg-base); border-bottom: 1px solid var(--border-glass); }
  .corner { position: sticky; left: 0; z-index: 7; display: flex; align-items: flex-end; padding: 0 12px 8px; background: var(--bg-base);
    border-right: 1px solid var(--border-glass); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .grip { position: absolute; top: 0; bottom: 0; right: -4px; width: 8px; padding: 0; border: none; background: none; cursor: col-resize; z-index: 8; touch-action: none; }
  .grip::after { content: ''; position: absolute; top: 25%; bottom: 25%; left: 3px; width: 2px; border-radius: 2px; background: var(--border-glass); }
  .grip:hover::after, .grip:focus-visible::after { background: var(--accent); }
  .grip:focus { outline: none; }
  .tier { position: relative; }
  .tier.top { height: 24px; border-bottom: 1px solid color-mix(in srgb, var(--border-glass) 60%, transparent); }
  .tier.bottom { height: 26px; }
  .tier.bottom.days { height: 36px; }
  .cell { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; padding-left: 8px; overflow: hidden; white-space: nowrap;
    border-left: 1px solid color-mix(in srgb, var(--border-glass) 70%, transparent); color: var(--text-secondary); }
  .cell b { font-size: 12px; font-weight: 600; }
  /* Month names stay readable while their month scrolls past the task column. */
  .top .cell { overflow: visible; }
  .top .cell b { position: sticky; left: calc(var(--lw) + 8px); color: var(--text-primary); font-size: 12.5px; }
  .bottom .cell b { font-weight: 500; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .cell.day { flex-direction: column; justify-content: center; align-items: center; padding: 0; gap: 1px; line-height: 1.1; }
  .cell.day i { font-style: normal; font-size: 10px; text-transform: uppercase; color: var(--text-muted); }
  .cell.day b { font-size: 12.5px; color: var(--text-secondary); }
  .cell.weekend { background: rgba(255, 255, 255, 0.025); }
  .cell.weekend i, .cell.weekend b { opacity: 0.6; }
  .cell.today { background: var(--accent-dim); }
  .cell.today i, .cell.today b { color: var(--accent); opacity: 1; font-weight: 700; }
  .cell.day.today b { background: var(--accent); color: var(--bg-base); border-radius: 999px; min-width: 22px; text-align: center; padding: 0 4px; }

  /* ---- body ---- */
  .body { position: relative; }
  .bg { position: absolute; top: 0; bottom: 0; left: var(--lw); width: var(--tw); pointer-events: none; }
  .wkend { position: absolute; top: 0; bottom: 0; background: rgba(255, 255, 255, 0.025); }
  .line { position: absolute; top: 0; bottom: 0; width: 1px; background: color-mix(in srgb, var(--border-glass) 45%, transparent); }
  .todaycol { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .now { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--accent); opacity: 0.85; z-index: 2; }

  .ghead { position: relative; height: 32px; display: flex; align-items: flex-end;
    border-top: 1px solid var(--border-glass); background: color-mix(in srgb, var(--bg-base) 55%, transparent); }
  .ghead:first-child { border-top: none; }
  .gt { position: sticky; left: 0; z-index: 3; display: flex; align-items: baseline; gap: 8px; padding: 0 12px 6px; white-space: nowrap; }
  .gt b { font-size: 13px; font-weight: 650; color: var(--text-primary); }
  .gs { font-size: 12px; color: var(--text-muted); }
  .gc { font-size: 11px; font-weight: 600; padding: 0 7px; border-radius: 999px; background: var(--bg-glass-hover); color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .ghead.overdue .gt b { color: var(--red); }
  .ghead.overdue .gc { background: var(--red-dim); color: var(--red); }
  .ghead.today .gt b { color: var(--accent); }
  .ghead.today .gc { background: var(--accent-dim); color: var(--accent); }
  .ghead.closed .gt b { color: var(--green); }
  button.und { background: none; border: none; cursor: pointer; font: inherit; align-items: center; }
  button.und b { color: var(--text-muted); text-transform: uppercase; font-size: 12px; letter-spacing: 0.05em; }
  button.und :global(svg) { color: var(--text-muted); transition: transform 0.15s ease; transform: rotate(-90deg); }
  button.und.open :global(svg) { transform: rotate(0deg); }
  button.und:hover b { color: var(--text-primary); }

  .emptyrow { height: 30px; display: flex; align-items: center; }
  .emptyrow span { position: sticky; left: 0; padding: 0 12px 0 34px; font-size: 12.5px; font-style: italic; color: var(--text-muted); }

  .row { position: relative; display: grid; grid-template-columns: var(--lw) var(--tw); height: var(--row); cursor: pointer; }
  .row:hover .lane, .row:focus-visible .lane { background: rgba(255, 255, 255, 0.035); }
  .row:hover .label { background: color-mix(in srgb, var(--bg-base) 92%, white); }
  .row:focus { outline: none; }
  .row:focus-visible .label { box-shadow: inset 0 0 0 2px var(--accent); }

  .label { position: sticky; left: 0; z-index: 4; display: flex; align-items: center; gap: 9px; min-width: 0; padding: 0 10px 0 9px;
    background: var(--bg-base); border-right: 1px solid var(--border-glass); border-left: 3px solid var(--c, transparent); }
  .ti { flex: 1; min-width: 0; font-size: 14px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .side { display: inline-flex; align-items: center; gap: 6px; flex: none; }
  .cat { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; color: var(--svc); background: color-mix(in srgb, var(--svc) 14%, transparent); }
  .prio { font-size: 10.5px; font-weight: 700; padding: 0 5px; border-radius: 4px; color: var(--text-muted); border: 1px solid var(--border-glass); }
  .prio.high { color: var(--amber); border-color: var(--amber-border); background: var(--amber-dim); }

  /* Status glyph, same language as the By day list. */
  .st { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--text-muted); flex: none; }
  .row.progress .st { border-color: var(--accent); background: conic-gradient(var(--accent) 0 50%, transparent 50% 100%); }
  .row.snoozed .st { border-style: dashed; border-color: var(--amber); }
  .row.late .st { border-color: var(--red); }
  .row.done .st { border-color: var(--green); background: var(--green); }
  .row.shelved .st { border-color: var(--text-muted); background: var(--text-muted); }
  .row.done .ti, .row.shelved .ti { color: var(--text-muted); }

  .lane { position: relative; min-width: 0; }
  .lead { position: absolute; top: 50%; height: 3px; margin-top: -1.5px; border-radius: 2px;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--c) 50%, transparent)); }
  .latebar { position: absolute; top: 50%; height: 20px; margin-top: -10px; border-radius: 0 6px 6px 0;
    background: repeating-linear-gradient(-45deg, var(--red-dim) 0 6px, color-mix(in srgb, var(--red) 20%, transparent) 6px 12px);
    border: 1px solid var(--red-border); border-left: none; }

  .mk { position: absolute; top: 50%; display: grid; place-items: center; color: #0b0b14; z-index: 1; }
  .mk.day { height: 22px; margin-top: -11px; border-radius: 6px; background: var(--c); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45); }
  .mk.point { width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 3px; transform: rotate(45deg); background: var(--c); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45); }
  .mk.point :global(svg) { transform: rotate(-45deg); }
  .row.progress .mk { box-shadow: 0 0 0 2px var(--bg-base), 0 0 0 4px var(--accent); }
  .row.late .mk { box-shadow: 0 0 0 2px var(--bg-base), 0 0 0 4px var(--red); }
  .row.snoozed .mk { background: color-mix(in srgb, var(--c) 35%, transparent); outline: 2px dashed var(--amber); outline-offset: 1px; }
  .row.done .mk { background: color-mix(in srgb, var(--green) 75%, transparent); }
  .row.shelved .mk { background: var(--text-muted); opacity: 0.6; }
  .row.blocked .mk { opacity: 0.55; }
  .row:hover .mk { filter: brightness(1.15); }

  .tag { position: absolute; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: baseline; gap: 7px; max-width: 340px;
    font-size: 12.5px; color: var(--text-secondary); white-space: nowrap; pointer-events: none; z-index: 1; }
  .tag span { overflow: hidden; text-overflow: ellipsis; }
  .tag em { font-style: normal; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-muted); }
  .tag em.late { color: var(--red); }
  .row.done .tag, .row.shelved .tag { color: var(--text-muted); }

  .undated-row .label { border-left-style: dashed; }

  /* A cell too narrow for its label (the clipped first/last one) stays blank. */
  .cell.tight b { visibility: hidden; }

  .off { position: absolute; top: 50%; transform: translateY(-50%); z-index: 2; display: inline-flex; align-items: center; gap: 3px;
    padding: 1px 7px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; pointer-events: none;
    color: var(--text-secondary); background: var(--bg-base); border: 1px solid var(--border-glass); }
  .off.left :global(svg) { transform: rotate(90deg); }
  .off.right { transform: translate(-100%, -50%); }
  .off.right :global(svg) { transform: rotate(-90deg); }
  .off.late { color: var(--red); border-color: var(--red-border); }

  .empty { color: var(--text-muted); font-size: 13px; }

  .tip { position: fixed; z-index: 60; width: 300px; padding: 10px 12px; border-radius: 10px; pointer-events: none;
    background: color-mix(in srgb, var(--bg-base) 94%, transparent); border: 1px solid var(--border-glass);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); backdrop-filter: blur(10px); }
  .tt { display: block; font-size: 14px; font-weight: 600; color: var(--text-primary); line-height: 1.3; }
  .ts { margin-top: 4px; font-size: 12.5px; color: var(--text-secondary); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .ts :global(p) { margin: 0; display: inline; }
  .ts :global(strong) { color: var(--text-primary); }
  .ts :global(code) { background: var(--bg-glass-hover); padding: 0 3px; border-radius: 3px; }
  .ts :global(ul), .ts :global(ol) { display: inline; padding: 0; margin: 0; list-style: none; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin-top: 8px; font-size: 12.5px; }
  dt { color: var(--text-muted); }
  dd { color: var(--text-primary); }
  dd.late { color: var(--red); }
  dd.progress { color: var(--accent); }
  dd.snoozed { color: var(--amber); }
  dd.done { color: var(--green); }

  /* Narrow: a slim title column with two-line titles; the inline label carries the rest. */
  .gantt.narrow .legend { display: none; }
  .gantt.narrow .ti { white-space: normal; font-size: 13px; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .gantt.narrow .tag { max-width: 220px; }
</style>
