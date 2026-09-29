<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { tasks, selectedTaskId } from '$lib/stores/tasks';
  import { config } from '$lib/stores/config';
  import { fmtDayMonth, fmtDateTime } from '$lib/format';
  import { sameDay } from '$lib/time';
  import Icon from './Icon.svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    subjectsOf, topicsOf, reviewDaysOf, daysUntil, progressOf, paceOf,
    topicState, axisPos, type PaceStatus, type StudySubject,
  } from '$lib/study';
  import type { Task } from '$lib/types';

  const DAY = 86_400_000;
  const clampPct = (n: number) => Math.min(100, Math.max(0, n));

  let now = $state(new Date());
  onMount(() => {
    const id = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(id);
  });

  // 'per-exam' normalises every subject to its own [start … exam] window (each
  // exam gets full width). 'shared' places all subjects on one real-date axis, so
  // near exams sit left and far ones right, with a single aligned "today" line.
  let mode = $state<'per-exam' | 'shared'>('per-exam');
  let info = $state(false); // reveal the legend and inline labels

  interface Dot { pos: number; state: 'done' | 'overdue' | 'pending'; task: Task; }
  interface Tick { pos: number; label: string; today: boolean; }
  interface Lane {
    key: string; label: string; icon: string; color: string;
    exam: string; days: number;
    reviewLeft: number; reviewWidth: number; wallPos: number; nowPos: number;
    dots: Dot[]; ticks: Tick[];
    pct: number; expectedPct: number; status: PaceStatus;
    done: number; total: number; plannedDueByNow: number;
  }

  // Shared window spans the earliest study start to the latest exam.
  const gWin = $derived.by(() => {
    const subs = subjectsOf($config);
    if (!subs.length) return null;
    let start = Infinity, end = -Infinity;
    for (const s of subs) {
      start = Math.min(start, s.start_date ? Date.parse(s.start_date) : now.getTime());
      end = Math.max(end, Date.parse(s.exam_date));
    }
    return { start, end };
  });

  // Map an ISO date to an x% — against the subject window (per-exam) or the shared one.
  function posOf(iso: string, s: StudySubject): number {
    if (mode === 'shared' && gWin) {
      const span = gWin.end - gWin.start;
      return span > 0 ? clampPct(((Date.parse(iso) - gWin.start) / span) * 100) : 0;
    }
    return axisPos(iso, s.start_date, s.exam_date, now);
  }

  function ticksFor(startMs: number, endMs: number, map: (iso: string) => number, n: Date): Tick[] {
    const spanDays = (endMs - startMs) / DAY;
    const step = spanDays <= 20 ? 3 : spanDays <= 60 ? 7 : 14;
    const out: Tick[] = [];
    const first = new Date(startMs); first.setHours(0, 0, 0, 0);
    for (let t = first.getTime(); t <= endMs + DAY; t += step * DAY) {
      const d = new Date(t);
      out.push({ pos: clampPct(map(d.toISOString())), label: fmtDayMonth(d), today: sameDay(d, n) });
    }
    return out;
  }

  const lanes = $derived.by<Lane[]>(() =>
    subjectsOf($config).map((s) => {
      const topics = topicsOf($tasks as Task[], s.key);
      const review = reviewDaysOf(s, $config);
      const pace = paceOf(topics, s.start_date, s.exam_date, review, now);
      const reviewStartIso = new Date(Date.parse(s.exam_date) - review * DAY).toISOString();
      const startMs = s.start_date ? Date.parse(s.start_date) : now.getTime();
      const wallPos = posOf(s.exam_date, s);
      const reviewLeft = posOf(reviewStartIso, s);
      const dots = topics
        .slice()
        .sort((a, b) => a.due_at.localeCompare(b.due_at))
        .map((t) => ({ pos: posOf(t.due_at, s), state: topicState(t, now), task: t }));
      return {
        key: s.key, label: s.label, icon: s.icon, color: s.color,
        exam: s.exam_date, days: daysUntil(s.exam_date, now),
        reviewLeft, reviewWidth: Math.max(0, wallPos - reviewLeft), wallPos,
        nowPos: posOf(now.toISOString(), s),
        dots, ticks: ticksFor(startMs, Date.parse(s.exam_date), (iso) => posOf(iso, s), now),
        pct: pace.pct, expectedPct: pace.expectedPct, status: pace.status,
        done: pace.done, total: pace.total, plannedDueByNow: pace.plannedDueByNow,
      };
    })
  );

  const globalTicks = $derived.by<Tick[]>(() => {
    if (mode !== 'shared' || !gWin) return [];
    const subs = subjectsOf($config);
    if (!subs.length) return [];
    const span = gWin.end - gWin.start;
    return ticksFor(gWin.start, gWin.end, (iso) => span > 0 ? clampPct(((Date.parse(iso) - gWin.start) / span) * 100) : 0, now);
  });
  const globalNowPos = $derived(gWin ? clampPct(((now.getTime() - gWin.start) / (gWin.end - gWin.start)) * 100) : 0);

  const PACE_LABEL: Record<PaceStatus, () => string> = {
    none: () => '', behind: m.study_pace_behind, slightly_behind: m.study_pace_slightly,
    on_track: m.study_pace_ontrack, ahead: m.study_pace_ahead,
  };

  function countdown(days: number): string {
    if (days === 0) return m.study_today();
    if (days < 0) return `${-days}${m.study_days_suffix()} ${m.study_overdue()}`;
    return `${m.study_in()} ${days}${m.study_days_suffix()}`;
  }

  // Hover preview: a short intent delay keeps the same progressive feel as the agenda peek cards.
  interface Preview { laneKey: string; pos: number; color: string; task: Task; state: Dot['state']; below: boolean; }
  let preview = $state<Preview | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function enter(l: Lane, d: Dot, below: boolean) {
    clearTimeout(timer);
    timer = setTimeout(() => { preview = { laneKey: l.key, pos: d.pos, color: l.color, task: d.task, state: d.state, below }; }, 240);
  }
  function leave() { clearTimeout(timer); preview = null; }
</script>

<div class="study">
  <div class="head">
    <h2><Icon name="calendar" size={18} /> {m.study_view_exams()}</h2>
    <div class="controls">
      <div class="seg" role="group">
        <button class:on={mode === 'per-exam'} onclick={() => (mode = 'per-exam')}>{m.study_mode_per_exam()}</button>
        <button class:on={mode === 'shared'} onclick={() => (mode = 'shared')}>{m.study_mode_shared()}</button>
      </div>
      <button class="info-btn" class:on={info} onclick={() => (info = !info)}
        title={m.study_info()} aria-label={m.study_info()} aria-pressed={info}><Icon name="info" size={16} /></button>
    </div>
  </div>

  {#if info}
    <div class="legend glass" transition:fly={{ y: -6, duration: 140 }}>
      <span class="lg"><i class="gl done"></i> {m.study_lg_done()}</span>
      <span class="lg"><i class="gl pending"></i> {m.study_lg_pending()}</span>
      <span class="lg"><i class="gl overdue"></i> {m.study_lg_overdue()}</span>
      <span class="lg"><i class="sw review"></i> {m.study_lg_review()}</span>
      <span class="lg"><i class="sw wall"></i> {m.study_lg_exam()}</span>
      <span class="lg"><i class="sw now"></i> {m.study_lg_today()}</span>
      <span class="lg"><i class="sw target"></i> {m.study_lg_target()}</span>
      <span class="lg"><i class="sw pace"></i> {m.study_lg_pace()}</span>
    </div>
  {/if}

  {#if lanes.length === 0}
    <p class="empty">{m.study_empty()}</p>
  {/if}

  {#if mode === 'shared' && lanes.length}
    <div class="shared-ruler">
      <div class="track">
        <span class="now" style={`left:${globalNowPos}%`}>{#if info}<small class="tag">{m.study_lg_today()}</small>{/if}</span>
        {#each globalTicks as tk}
          <span class="tick" class:today={tk.today} style={`left:${tk.pos}%`}><i></i><small>{tk.label}</small></span>
        {/each}
      </div>
    </div>
  {/if}

  <div class="lanes">
    {#each lanes as l, li (l.key)}
      <section class="lane glass" class:raise={preview?.laneKey === l.key} style={`--c:${l.color}`}>
        <div class="lane-head">
          <span class="ico"><Icon name={l.icon} size={18} /></span>
          <span class="name">{l.label}</span>
          <span class="exam">
            <b class:soon={l.days >= 0 && l.days <= 7} class:over={l.days < 0}>{countdown(l.days)}</b>
            <span class="date">{m.study_exam()} · {fmtDayMonth(new Date(l.exam))}</span>
          </span>
        </div>

        <div class="meter-row">
          <div class="meter" title={`${l.done}/${l.total} · ${Math.round(l.pct * 100)}% (${m.study_target()} ${Math.round(l.expectedPct * 100)}%)`}>
            <div class="fill" class:behind={l.status === 'behind'} class:slight={l.status === 'slightly_behind'}
              style={`width:${l.pct * 100}%`}></div>
            <span class="target" style={`left:${l.expectedPct * 100}%`} title={m.study_lg_target()}>
              {#if info}<small class="tag">{m.study_target()}</small>{/if}
            </span>
          </div>
          <span class="count">{l.done}/{l.total} {m.study_done_label()}</span>
          {#if l.status !== 'none'}
            <span class={`badge ${l.status}`} title={m.study_lg_pace()}>
              {PACE_LABEL[l.status]()}
              {#if l.status === 'behind' || l.status === 'slightly_behind'}
                <em>· {m.study_expected_short()} {l.plannedDueByNow}, {m.study_done_label()} {l.done}</em>
              {/if}
            </span>
          {/if}
        </div>

        <div class="axis">
          <span class="line"></span>
          {#if l.reviewWidth > 0}
            <span class="review" style={`left:${l.reviewLeft}%; width:${l.reviewWidth}%`} title={m.study_lg_review()}></span>
          {/if}
          <span class="wall" style={`left:${l.wallPos}%`} title={`${m.study_lg_exam()} · ${fmtDayMonth(new Date(l.exam))}`}>
            {#if info}<small class="tag">{m.study_exam()}</small>{/if}
          </span>
          <span class="now" style={`left:${l.nowPos}%`} title={m.study_lg_today()}>
            {#if info}<small class="tag">{m.study_lg_today()}</small>{/if}
          </span>
          {#each l.dots as d (d.task.id)}
            <button class={`dot ${d.state}`} style={`left:${d.pos}%`}
              title={`${d.task.title} · ${fmtDayMonth(new Date(d.task.due_at))}`}
              onmouseenter={() => enter(l, d, li === 0)} onmouseleave={leave}
              onfocus={() => enter(l, d, li === 0)} onblur={leave}
              onclick={() => selectedTaskId.set(d.task.id)} aria-label={d.task.title}></button>
          {/each}

          {#if preview && preview.laneKey === l.key}
            {@const p = preview}
            <div class="peek" class:below={p.below} style={`left:${p.pos}%; --c:${p.color}`}
              transition:fly={{ y: p.below ? -8 : 8, duration: 150 }}>
              <div class="peek-top">
                <span class={`pdot ${p.state}`}></span>
                <span class="ptitle">{p.task.title}</span>
              </div>
              <div class="pmeta">
                <span class="pdue" class:over={p.state === 'overdue'} class:done={p.state === 'done'}>
                  <Icon name={p.state === 'done' ? 'check' : 'clock'} size={12} />
                  {p.state === 'done' ? m.status_done() : m.tl_due()} {fmtDateTime(new Date(p.task.due_at))}
                </span>
              </div>
              {#if p.task.summary}<p class="psum">{p.task.summary}</p>{/if}
              {#if p.task.last_note?.body}
                <p class="pnote"><Icon name="note" size={12} /> {p.task.last_note.body}</p>
              {/if}
              <div class="ptags">
                <span class="chip" style={`--c:${p.color}`}>{l.label}</span>
                {#each (p.task.tags ?? []) as t}<span class="chip tag">#{t}</span>{/each}
              </div>
            </div>
          {/if}
        </div>

        {#if mode === 'per-exam'}
          <div class="ruler">
            {#each l.ticks as tk}
              <span class="tick" class:today={tk.today} style={`left:${tk.pos}%`}><i></i><small>{tk.label}</small></span>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  </div>
</div>

<style>
  .study { display: flex; flex-direction: column; gap: 14px; height: 100%; overflow-y: auto; }
  .head { display: flex; align-items: center; gap: 12px; }
  .head h2 { display: inline-flex; align-items: center; gap: 8px; font-family: 'Syne', system-ui, sans-serif; font-size: 20px; color: var(--text-primary); }
  .controls { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
  .seg { display: inline-flex; border: 1px solid var(--border-glass); border-radius: 7px; overflow: hidden; }
  .seg button { background: var(--bg-glass); border: none; color: var(--text-secondary); padding: 5px 11px; font-size: 12.5px; cursor: pointer; border-right: 1px solid var(--border-glass); }
  .seg button:last-child { border-right: none; }
  .seg button:hover { background: var(--bg-glass-hover); }
  .seg button.on { background: var(--accent-dim); color: var(--accent); font-weight: 600; }
  .info-btn { display: inline-flex; align-items: center; justify-content: center; padding: 6px 8px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 7px; color: var(--text-muted); cursor: pointer; }
  .info-btn:hover { color: var(--text-secondary); }
  .info-btn.on { background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent); }
  .empty { color: var(--text-muted); }

  .legend { display: flex; flex-wrap: wrap; gap: 10px 22px; padding: 11px 16px; border-radius: 10px; font-size: 12px; color: var(--text-secondary); }
  .legend .lg { display: inline-flex; align-items: center; gap: 9px; }
  .legend .gl { flex: 0 0 auto; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--text-secondary); background: var(--bg-base); }
  .legend .gl.done { background: var(--text-secondary); }
  .legend .gl.pending { background: var(--bg-base); }
  .legend .gl.overdue { border-color: var(--red, #e06c6c); background: var(--red, #e06c6c); }
  .legend .sw { flex: 0 0 auto; width: 16px; height: 10px; border-radius: 2px; display: inline-block; }
  .legend .sw.review { background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--text-secondary) 40%, transparent) 0 4px, transparent 4px 8px); }
  .legend .sw.wall { width: 3px; height: 14px; background: var(--accent); border-radius: 2px; }
  .legend .sw.now { width: 2px; height: 14px; background: var(--text-primary); }
  .legend .sw.target { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 7px solid var(--amber, #e0a458); }
  .legend .sw.pace { background: var(--green, #6bbf83); }

  .lanes { display: flex; flex-direction: column; gap: 12px; }
  .lane { position: relative; padding: 14px 16px; border-radius: 12px; border-left: 3px solid var(--c); display: flex; flex-direction: column; gap: 12px; }
  .lane.raise { z-index: 30; }
  .lane-head { display: flex; align-items: center; gap: 10px; }
  .lane-head .ico { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 9px; color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); }
  .lane-head .name { font-size: 16px; font-weight: 700; color: var(--text-primary); flex: 1; }
  .lane-head .exam { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.2; }
  .lane-head .exam b { font-size: 14px; color: var(--text-secondary); }
  .lane-head .exam b.soon { color: var(--amber, #e0a458); }
  .lane-head .exam b.over { color: var(--red, #e06c6c); }
  .lane-head .exam .date { font-size: 11px; color: var(--text-muted); }

  .meter-row { display: flex; align-items: center; gap: 12px; }
  .meter { position: relative; flex: 1; height: 10px; border-radius: 6px; background: var(--bg-glass-hover); overflow: visible; }
  .meter .fill { position: absolute; inset: 0 auto 0 0; height: 100%; border-radius: 6px; background: var(--c); transition: width 0.3s ease; }
  .meter .fill.behind { background: var(--red, #e06c6c); }
  .meter .fill.slight { background: var(--amber, #e0a458); }
  /* target = a small downward flag onto the bar (distinct from the white "today" line) */
  .meter .target { position: absolute; top: -7px; width: 0; height: 0; transform: translateX(-5px);
    border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 7px solid var(--amber, #e0a458); }
  .meter .target .tag { position: absolute; top: -15px; left: 50%; transform: translateX(-50%); }
  .meter-row .count { font-size: 12px; color: var(--text-muted); white-space: nowrap; }

  .badge { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.03em; }
  .badge em { font-weight: 500; font-style: normal; text-transform: none; letter-spacing: 0; opacity: 0.85; }
  .badge.behind { color: #fff; background: var(--red, #e06c6c); }
  .badge.slightly_behind { color: #3a2a06; background: var(--amber, #e0a458); }
  .badge.on_track { color: var(--green, #6bbf83); background: color-mix(in srgb, var(--green, #6bbf83) 18%, transparent); }
  .badge.ahead { color: var(--accent); background: var(--accent-dim); }

  .axis { position: relative; height: 26px; margin-top: 2px; }
  .axis .line { position: absolute; left: 0; right: 0; top: 50%; height: 2px; background: var(--border-glass); transform: translateY(-50%); }
  .axis .review { position: absolute; top: 4px; bottom: 4px; background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--c) 22%, transparent) 0 6px, transparent 6px 12px); border-radius: 4px; }
  .axis .now { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--text-primary); transform: translateX(-1px); z-index: 2; }
  .axis .wall { position: absolute; top: 0; bottom: 0; width: 3px; background: var(--c); border-radius: 2px; transform: translateX(-1px); }
  .axis .tag, .shared-ruler .tag { position: absolute; top: -15px; left: 50%; transform: translateX(-50%); font-size: 9px; line-height: 1; padding: 2px 5px; border-radius: 5px; white-space: nowrap; color: var(--text-primary); background: var(--bg-glass-hover); border: 1px solid var(--border-glass); }
  /* keep the exam label inside the lane: sit it to the left of the wall line */
  .axis .wall .tag { color: var(--c); left: auto; right: 100%; margin-right: 4px; transform: none; }
  .dot { position: absolute; top: 50%; width: 13px; height: 13px; border-radius: 50%; transform: translate(-50%, -50%); cursor: pointer; padding: 0; border: 2px solid var(--c); background: var(--bg-base); transition: box-shadow 0.15s ease, transform 0.12s ease; z-index: 3; }
  .dot:hover { transform: translate(-50%, -50%) scale(1.25); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 25%, transparent); z-index: 5; }
  .dot.done { background: var(--c); }
  .dot.overdue { border-color: var(--red, #e06c6c); background: var(--red, #e06c6c); }
  .dot.pending { background: var(--bg-base); }

  /* Hover preview — an agenda-style peek card anchored to the dot. */
  .peek {
    position: absolute; bottom: calc(100% + 10px); left: 0; transform: translateX(-50%);
    width: 268px; max-width: 78vw; z-index: 20; pointer-events: none;
    padding: 11px 13px; border-radius: 11px;
    background: var(--bg-base); border: 1px solid var(--border-glass); border-left: 3px solid var(--c);
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55); display: flex; flex-direction: column; gap: 7px;
  }
  .peek::after { content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); border: 6px solid transparent; border-top-color: var(--bg-base); }
  .peek.below { bottom: auto; top: calc(100% + 10px); }
  .peek.below::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: var(--bg-base); }
  .peek-top { display: flex; align-items: flex-start; gap: 7px; }
  .peek .pdot { margin-top: 4px; width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; border: 2px solid var(--c); background: var(--bg-base); }
  .peek .pdot.done { background: var(--c); }
  .peek .pdot.overdue { border-color: var(--red, #e06c6c); background: var(--red, #e06c6c); }
  .peek .ptitle { font-size: 14px; font-weight: 700; color: var(--text-primary); line-height: 1.25; }
  .pmeta .pdue { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--text-secondary); }
  .pmeta .pdue.over { color: var(--red, #e06c6c); }
  .pmeta .pdue.done { color: var(--green, #6bbf83); }
  .peek .psum { font-size: 12.5px; color: var(--text-secondary); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .peek .pnote { display: flex; gap: 5px; font-size: 11.5px; color: var(--text-muted); line-height: 1.35; padding: 6px 8px; background: var(--bg-glass-hover); border-radius: 7px; }
  .ptags { display: flex; flex-wrap: wrap; gap: 5px; }
  .ptags .chip { font-size: 10.5px; padding: 2px 7px; border-radius: 999px; color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); font-weight: 600; }
  .ptags .chip.tag { color: var(--text-muted); background: var(--bg-glass-hover); }

  /* Shared-mode ruler across the top. */
  .shared-ruler { position: relative; padding: 0 16px; }
  .shared-ruler .track { position: relative; height: 26px; }
  .shared-ruler .now { position: absolute; top: 0; bottom: -6px; width: 2px; background: var(--text-primary); transform: translateX(-1px); z-index: 2; }

  /* Ruler ticks (per-lane and shared). */
  .ruler { position: relative; height: 18px; }
  .tick { position: absolute; top: 0; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .tick i { width: 1px; height: 5px; background: var(--border-glass); display: block; }
  .tick small { font-size: 10px; color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .tick.today i { background: var(--text-primary); height: 7px; }
  .tick.today small { color: var(--text-primary); font-weight: 700; }
</style>
