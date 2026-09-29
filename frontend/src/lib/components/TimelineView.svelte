<script lang="ts">
  import { onMount } from 'svelte';
  import { tasks, selectedTaskId } from '$lib/stores/tasks';
  import { scopeFilter, activeScopeIsHidden } from '$lib/stores/scope';
  import { searchFilter } from '$lib/stores/search';
  import { fmtDayShort, fmtDayMonth, monthLong, fmtDateTime, bucketLabel } from '$lib/format';
  import * as m from '$lib/paraglide/messages';
  import type { Task } from '$lib/types';
  import {
    bucket, BUCKET_ORDER, barKind, barEndDate, hasDue,
    startOfDay, addDays, sameDay, type BarKind,
  } from '$lib/time';
  import { config, taskColor } from '$lib/stores/config';

  const DAY = 86_400_000;

  let now = $state(new Date());
  onMount(() => {
    const id = setInterval(() => (now = new Date()), 30_000);
    return () => clearInterval(id);
  });

  type Range = 'fit' | '14' | '30' | '90';
  type Scale = 'linear' | 'compact';
  let range = $state<Range>('fit');
  let scale = $state<Scale>('linear');
  let expanded = $state(false);

  const RANGES: [Range, () => string][] = [['fit', m.tl_range_fit], ['14', m.tl_range_2w], ['30', m.tl_range_1m], ['90', m.tl_range_3m]];
  const SCALES: [Scale, () => string][] = [['linear', m.tl_scale_linear], ['compact', m.tl_scale_compact]];

  interface Bar { task: Task; kind: BarKind; start: Date; end: Date; }

  const bars = $derived.by<Bar[]>(() =>
    ($tasks as Task[])
      // General (open, no-deadline) tasks have no end date to place on the axis — exclude them.
      .filter((t) => $scopeFilter(t) && $searchFilter(t) && (hasDue(t) || t.status === 'done'))
      .map((t) => ({ task: t, kind: barKind(t), start: new Date(t.created_at), end: barEndDate(t) }))
  );

  const win = $derived.by(() => {
    if (range !== 'fit') {
      const wStart = startOfDay(addDays(now, -2));
      const wEnd = addDays(startOfDay(now), Number(range));
      return { start: wStart.getTime(), end: wEnd.getTime(), days: Math.round((wEnd.getTime() - wStart.getTime()) / DAY) };
    }
    const starts = bars.map((b) => b.start.getTime());
    const ends = bars.map((b) => b.end.getTime());
    const minT = Math.min(now.getTime(), ...starts);
    const maxT = Math.max(addDays(now, 1).getTime(), ...ends);
    let wStart = startOfDay(new Date(minT));
    let wEnd = addDays(startOfDay(new Date(maxT)), 1);
    let days = Math.round((wEnd.getTime() - wStart.getTime()) / DAY);
    if (days > 365) {
      wStart = addDays(startOfDay(now), -3);
      days = Math.round((wEnd.getTime() - wStart.getTime()) / DAY);
      if (days > 365) { wEnd = addDays(wStart, 365); days = 365; }
    }
    return { start: wStart.getTime(), end: wEnd.getTime(), days };
  });

  // Compact (non-linear) scale: keep only the time spans where something is alive
  // (a task's created→due interval, plus today), collapse the empty gaps between them.
  const aliveSegments = $derived.by<[number, number][]>(() => {
    const ivs: [number, number][] = [];
    for (const b of bars) {
      const s = Math.max(b.start.getTime(), win.start);
      const e = Math.min(b.end.getTime(), win.end);
      if (e >= s) ivs.push([s, e]);
    }
    ivs.push([Math.max(win.start, startOfDay(now).getTime()), Math.min(win.end, addDays(startOfDay(now), 1).getTime())]);
    ivs.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [s, e] of ivs) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1] + DAY) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    return merged;
  });

  const layout = $derived.by(() => {
    const PX_DAY = 66, GAP = 32, MIN_SEG = 26;
    const segs: { s: number; e: number; x0: number; x1: number }[] = [];
    let x = 0;
    aliveSegments.forEach((iv, i) => {
      if (i > 0) x += GAP;
      const days = Math.max((iv[1] - iv[0]) / DAY, 0.05);
      const w = Math.max(days * PX_DAY, MIN_SEG);
      segs.push({ s: iv[0], e: iv[1], x0: x, x1: x + w });
      x += w;
    });
    return { segs, total: Math.max(x, 320) };
  });

  const activeDays = $derived(aliveSegments.reduce((a, [s, e]) => a + Math.max(1, Math.round((e - s) / DAY)), 0));

  function pos(t: number): number {
    if (scale === 'linear') return ((t - win.start) / (win.end - win.start)) * 100;
    const { segs, total } = layout;
    if (!segs.length) return 0;
    if (t <= segs[0].s) return (segs[0].x0 / total) * 100;
    const last = segs[segs.length - 1];
    if (t >= last.e) return (last.x1 / total) * 100;
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      if (t <= sg.e) {
        if (t >= sg.s) {
          const f = (t - sg.s) / Math.max(sg.e - sg.s, 1);
          return ((sg.x0 + f * (sg.x1 - sg.x0)) / total) * 100;
        }
        const prev = segs[i - 1];
        return (((prev.x1 + sg.x0) / 2) / total) * 100;
      }
    }
    return 100;
  }
  const clamp = (p: number) => Math.min(100, Math.max(0, p));

  const unitDays = $derived(scale === 'compact' ? activeDays : win.days);
  const step = $derived(unitDays <= 16 ? 1 : unitDays <= 70 ? 7 : 14);
  const trackMin = $derived(`${scale === 'compact' ? Math.round(layout.total) : Math.max(Math.ceil(win.days / step) * 66, 520)}px`);
  const dayW = $derived(scale === 'linear' ? `${(step / win.days) * 100}%` : '100%');

  const ticks = $derived.by(() => {
    const out: { left: number; label: string; today: boolean }[] = [];
    const mk = (d: Date) => step === 1 ? fmtDayShort(d) : fmtDayMonth(d);
    if (scale === 'linear') {
      for (let i = 0; i <= win.days; i += step) {
        const d = addDays(new Date(win.start), i);
        out.push({ left: pos(d.getTime()), label: mk(d), today: sameDay(d, now) });
      }
    } else {
      for (const sg of layout.segs) {
        let d = startOfDay(new Date(sg.s));
        if (d.getTime() < sg.s) d = addDays(d, 1);
        for (; d.getTime() <= sg.e + DAY; d = addDays(d, step)) {
          out.push({ left: pos(d.getTime()), label: mk(d), today: sameDay(d, now) });
        }
      }
    }
    return out;
  });

  const gaps = $derived.by(() => {
    if (scale !== 'compact') return [] as { left: number }[];
    const out: { left: number }[] = [];
    const segs = layout.segs;
    for (let i = 1; i < segs.length; i++) out.push({ left: ((segs[i - 1].x1 + segs[i].x0) / 2 / layout.total) * 100 });
    return out;
  });

  const months = $derived.by(() => {
    const out: { left: number; width: number; label: string }[] = [];
    let cur = new Date(win.start);
    cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
    while (cur.getTime() < win.end) {
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const left = pos(Math.max(cur.getTime(), win.start));
      const width = pos(Math.min(next.getTime(), win.end)) - left;
      if (width > 0.6) {
        const yr = cur.getFullYear() !== now.getFullYear() ? ` '${String(cur.getFullYear()).slice(2)}` : '';
        out.push({ left, width, label: monthLong(cur) + yr });
      }
      cur = next;
    }
    return out;
  });

  const nowLeft = $derived(clamp(pos(now.getTime())));
  const todayLeft = $derived(clamp(pos(startOfDay(now).getTime())));
  const todayW = $derived(`${Math.max(pos(addDays(startOfDay(now), 1).getTime()) - pos(startOfDay(now).getTime()), 0.6)}%`);

  const groups = $derived.by(() => {
    const g: Record<string, Bar[]> = {};
    for (const b of bars) {
      const key = b.task.status === 'done' ? 'done' : bucket(b.task, now);
      (g[key] ??= []).push(b);
    }
    for (const k of Object.keys(g)) g[k].sort((a, b) => a.task.due_at.localeCompare(b.task.due_at));
    return g;
  });

  const fmtTime = (d: Date) => fmtDateTime(d);

  function geom(b: Bar) {
    const left = clamp(pos(b.start.getTime()));
    const right = clamp(pos(b.end.getTime()));
    return { left, width: Math.max(right - left, 1.2), clipLeft: b.start.getTime() < win.start };
  }
</script>

<div class="timeline" class:expanded>
  <div class="bar-controls">
    <div class="seg">
      {#each RANGES as [val, lbl]}
        <button class:on={range === val} onclick={() => (range = val)}>{lbl()}</button>
      {/each}
    </div>
    <div class="seg">
      {#each SCALES as [val, lbl]}
        <button class:on={scale === val} onclick={() => (scale = val)}>{lbl()}</button>
      {/each}
    </div>
    <button class="expand" onclick={() => (expanded = !expanded)} title={m.tl_expand()}>
      {expanded ? `⤡ ${m.tl_collapse()}` : `⤢ ${m.tl_expand_label()}`}
    </button>
    <div class="legend">
      <span><i class="sw multi"></i> {m.tl_legend_category()}</span>
      <span><i class="cap">✓</i> {m.status_done()}</span>
      <span><i class="sw ring"></i> {m.overdue()}</span>
      <span><i class="nowdot"></i> {m.tl_legend_now()}</span>
      {#if scale === 'compact'}<span><i class="gapdot">⋯</i> {m.tl_legend_empty_days()}</span>{/if}
    </div>
  </div>

  <div class="chart">
    <!-- month band -->
    <div class="row band" style={`--track-min:${trackMin}`}>
      <div class="label head">{m.tl_task_header()}</div>
      <div class="track">
        {#each months as mo}
          <span class="month" style={`left:${mo.left}%; width:${mo.width}%`}>{mo.label}</span>
        {/each}
      </div>
    </div>

    <!-- day / week axis -->
    <div class="row axis" style={`--track-min:${trackMin}`}>
      <div class="label"></div>
      <div class="track">
        <span class="today-band" style={`left:${todayLeft}%; width:${todayW}`}></span>
        {#each ticks as tk}
          <span class="tick" class:today={tk.today} style={`left:${tk.left}%`}>
            <span class="tlabel">{tk.label}</span>
          </span>
        {/each}
        {#each gaps as gp}<span class="gapmark" style={`left:${gp.left}%`}>⋯</span>{/each}
        <span class="nowline" style={`left:${nowLeft}%`}><span class="nowtag">{m.tl_legend_now()}</span></span>
      </div>
    </div>

    {#each BUCKET_ORDER as gname}
      {#if groups[gname]?.length}
        <div class="group">{bucketLabel(gname)}</div>
        {#each groups[gname] as b (b.task.id)}
          {@const g = geom(b)}
          <div class="row" style={`--track-min:${trackMin}; --c:${taskColor(b.task, $config)}`}>
            <button class="label" onclick={() => selectedTaskId.set(b.task.id)} title={b.task.title}>
              <span class="dotc"></span>
              <span class="t">{b.task.title}</span>
            </button>
            <div class="track" style={`--dayw:${dayW}`}>
              {#each gaps as gp}<span class="gapline" style={`left:${gp.left}%`}></span>{/each}
              <button
                class={`bar ${b.kind}`}
                class:clip-left={g.clipLeft}
                style={`left:${g.left}%; width:${g.width}%`}
                onclick={() => selectedTaskId.set(b.task.id)}
                title={`${b.task.title}\n${m.td_created()}: ${fmtTime(b.start)}\n${b.kind === 'done' ? m.status_done() : m.tl_due()}: ${fmtTime(b.end)}`}
              >
                <span class="cap">{b.kind === 'done' ? '✓' : ''}</span>
              </button>
              <span class="nowline thin" style={`left:${nowLeft}%`}></span>
            </div>
          </div>
        {/each}
      {/if}
    {/each}
  </div>

  {#if bars.length === 0}
    <p class="empty">{$activeScopeIsHidden ? m.tl_empty_personal() : m.tl_empty()}</p>
  {/if}
</div>

<style>
  .timeline { display: flex; flex-direction: column; gap: 10px; height: 100%; overflow: hidden; }
  .timeline.expanded {
    position: fixed; inset: 0; z-index: 45; padding: 16px; gap: 12px;
    background: linear-gradient(135deg, var(--bg-base), var(--bg-deep));
  }

  .bar-controls { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
  .seg { display: inline-flex; border: 1px solid var(--border-glass); border-radius: 6px; overflow: hidden; }
  .seg button { background: var(--bg-glass); border: none; color: var(--text-secondary); padding: 5px 11px; font-size: 13px; cursor: pointer; border-right: 1px solid var(--border-glass); }
  .seg button:last-child { border-right: none; }
  .seg button:hover { background: var(--bg-glass-hover); }
  .seg button.on { background: var(--accent-dim); color: var(--accent); font-weight: 600; }
  .expand { background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-secondary); padding: 5px 11px; font-size: 13px; border-radius: 6px; cursor: pointer; }
  .expand:hover { background: var(--bg-glass-hover); color: var(--text-primary); }

  .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); margin-left: auto; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend .sw { width: 16px; height: 9px; border-radius: 2px; display: inline-block; }
  .legend .sw.multi { background: linear-gradient(90deg, #a78bfa, #34d399, #fb923c, #60a5fa); }
  .legend .sw.ring { background: var(--bg-glass-hover); box-shadow: 0 0 0 2px var(--red); }
  .legend .cap { font-style: normal; color: var(--green); font-weight: 700; }
  .legend .nowdot { width: 2px; height: 12px; background: var(--text-primary); display: inline-block; }
  .legend .gapdot { font-style: normal; color: var(--text-muted); }

  .chart { overflow: auto; flex: 1; border: 1px solid var(--border-glass); border-radius: 8px; background: var(--bg-glass); }

  .row { display: grid; grid-template-columns: 210px var(--track-min); align-items: center; }
  .row:not(.axis):not(.band):hover { background: var(--bg-glass-hover); }

  .label {
    position: sticky; left: 0; z-index: 3;
    display: flex; align-items: center; gap: 8px;
    padding: 9px 12px; min-width: 0;
    background: var(--bg-base);
    border-right: 1px solid var(--border-glass); border-left: 3px solid var(--c, transparent);
    color: var(--text-primary); font: inherit; text-align: left; cursor: pointer;
  }
  button.label:hover { background: var(--bg-glass-hover); }
  .label .dotc { width: 9px; height: 9px; border-radius: 50%; background: var(--c, var(--text-muted)); flex: 0 0 auto; }
  .label .t { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label.head { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); cursor: default; }

  .track {
    position: relative; height: 38px;
    background-image: repeating-linear-gradient(to right, var(--border-glass) 0 1px, transparent 1px var(--dayw, 100%));
  }
  .band .track, .axis .track { background-image: none; }
  .band .track { height: 24px; }
  .band .label { background: var(--bg-base); }
  .month { position: absolute; top: 4px; bottom: 4px; display: flex; align-items: center; padding-left: 8px; font-size: 12px; text-transform: capitalize; color: var(--text-secondary); border-left: 1px solid var(--border-glass); white-space: nowrap; overflow: hidden; }
  .axis .track { height: 30px; }

  .tick { position: absolute; top: 0; bottom: 0; transform: translateX(-50%); }
  .tick .tlabel { position: absolute; top: 7px; left: 50%; transform: translateX(-50%); font-size: 11px; color: var(--text-muted); white-space: nowrap; }
  .tick.today .tlabel { color: var(--accent); font-weight: 600; }

  .gapmark { position: absolute; top: 6px; transform: translateX(-50%); font-size: 13px; color: var(--text-muted); }
  .gapline { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px dashed var(--border-glass); transform: translateX(-50%); }

  .today-band { position: absolute; top: 0; bottom: 0; background: var(--accent-dim); }

  .nowline { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--text-primary); transform: translateX(-50%); z-index: 2; }
  .nowline.thin { opacity: 0.35; }
  .nowtag { position: absolute; top: -1px; left: 4px; font-size: 10px; color: var(--text-primary); background: var(--bg-base); padding: 1px 5px; border-radius: 4px; white-space: nowrap; }

  .bar {
    position: absolute; top: 50%; transform: translateY(-50%);
    height: 18px; border-radius: 9px; cursor: pointer; padding: 0;
    border: 1px solid transparent; min-width: 6px;
    display: flex; align-items: center; justify-content: flex-end;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); z-index: 1;
  }
  .bar:hover { filter: brightness(1.15); }
  .bar .cap { font-size: 11px; line-height: 1; padding-right: 4px; color: #06210f; font-weight: 700; }
  .bar.clip-left { border-top-left-radius: 0; border-bottom-left-radius: 0; }

  .bar.active { background: linear-gradient(90deg, color-mix(in srgb, var(--c) 42%, transparent), var(--c)); border-color: color-mix(in srgb, var(--c) 55%, transparent); }
  .bar.done { background: var(--c); opacity: 0.5; }
  .bar.done .cap { color: #06210f; }
  .bar.overdue { background: var(--c); box-shadow: 0 0 0 2px var(--red), 0 1px 3px rgba(0, 0, 0, 0.3); }
  .bar.snoozed { background: var(--c); opacity: 0.82; border-style: dashed; border-color: var(--amber-border); }

  .group {
    position: sticky; left: 0;
    padding: 7px 12px 3px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--text-muted); background: var(--bg-base);
  }

  .empty { color: var(--text-muted); }
</style>
