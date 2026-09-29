<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { tasks, selectedTaskId } from '$lib/stores/tasks';
  import { config, categoryMeta } from '$lib/stores/config';
  import { fmtDayMonth } from '$lib/format';
  import { renderMarkdown } from '$lib/markdown';
  import { taskRepo } from '$lib/stores/config';
  import { sameDay } from '$lib/time';
  import Icon from './Icon.svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    subjectsOf, topicsOf, reviewDaysOf, daysUntil, topicState, type StudySubject,
  } from '$lib/study';
  import type { Task, TaskStatus } from '$lib/types';

  interface Props { subjectKey: string; }
  let { subjectKey }: Props = $props();

  const DAY = 86_400_000;
  const CARD_W = 178, CARD_H = 66, GAP = 10;
  const AXIS_H = 58;                    // top header space (horizontal)
  const GUTTER = 66, SPINE_X = GUTTER + 12, V_CARD_X = GUTTER + 32; // vertical: date gutter, spine, card column
  const CARD_W_V = 320;                // wider cards in the vertical view
  const PPD_H = 70, PPD_V = 60;         // px per day (time scale) per orientation
  const EVEN_GAP_H = 0, EVEN_GAP_V = 54; // extra spacing between topics in "even" scale
  const V_PAD_R = 104;                  // right slack so today/exam labels clear the cards
  const EXP_W = 344, SLACK = 240, MIN_V = 340;

  type Orient = 'horizontal' | 'vertical';
  type Scale = 'time' | 'even';
  let orient = $state<Orient>('vertical');
  let scale = $state<Scale>('time');
  // Zoom the whole view (text + cards + spacing) in two larger steps for readability.
  let zoom = $state(1);
  const ZOOMS = [1, 1.2, 1.4];

  let now = $state(new Date());
  onMount(() => {
    const id = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(id);
  });

  let vw = $state(900); // measured viewport width of the scroll area

  const subject = $derived.by<StudySubject | null>(
    () => subjectsOf($config).find((s) => s.key === subjectKey) ?? null
  );
  const meta = $derived(categoryMeta(subjectKey, $config));
  const topics = $derived(
    topicsOf($tasks as Task[], subjectKey).slice().sort((a, b) => a.due_at.localeCompare(b.due_at))
  );

  const STATUS_LABEL: Record<TaskStatus, () => string> = {
    pending: m.status_pending, in_progress: m.status_in_progress,
    snoozed: m.status_snoozed, done: m.status_done, shelved: m.status_shelved,
  };

  interface Card { task: Task; state: 'done' | 'overdue' | 'pending'; main: number; lane: number; }
  interface Tick { u: number; label: string; today: boolean; }

  const layout = $derived.by(() => {
    const s = subject;
    if (!s || topics.length === 0) {
      return { mainLen: MIN_V, lanes: 1, cards: [] as Card[], ticks: [] as Tick[],
        uReviewStart: 0, uExam: 0, uNow: 0, review: 0 };
    }
    const review = reviewDaysOf(s, $config);
    const nowMs = now.getTime();
    const examMs = Date.parse(s.exam_date);
    const dues = topics.map((t) => Date.parse(t.due_at));
    // Axis starts at the first activity (not the far-back course start) so the view
    // doesn't open with a big empty stretch above the first topic.
    const start = Math.min(nowMs, ...dues) - DAY / 2;
    const end = Math.max(examMs, nowMs, ...dues) + DAY / 2;
    const span = Math.max(1, end - start);
    const spanDays = span / DAY;
    const n = topics.length;

    // Even scale: topic i lands at (i+1)/(n+1); arbitrary dates interpolate between
    // the bracketing anchors so today/exam sit correctly among evenly-spaced topics.
    const anchors = [{ ms: start, u: 0 }, ...dues.map((d, i) => ({ ms: d, u: (i + 1) / (n + 1) })), { ms: end, u: 1 }];
    const posU = (ms: number): number => {
      if (scale === 'time') return Math.min(1, Math.max(0, (ms - start) / span));
      if (ms <= anchors[0].ms) return 0;
      for (let i = 1; i < anchors.length; i++) {
        const a = anchors[i - 1], b = anchors[i];
        if (ms <= b.ms) {
          const w = b.ms - a.ms;
          return w > 0 ? a.u + ((ms - a.ms) / w) * (b.u - a.u) : b.u;
        }
      }
      return 1;
    };

    const isH = orient === 'horizontal';
    const extent = isH ? CARD_W : CARD_H;           // tile size along the time axis
    const viewMain = isH ? vw : MIN_V;
    const evenStep = extent + GAP + (isH ? EVEN_GAP_H : EVEN_GAP_V);
    const mainLen = scale === 'even'
      ? Math.max(viewMain, (n + 1) * evenStep)
      : Math.max(viewMain, Math.ceil(spanDays) * (isH ? PPD_H : PPD_V) + extent);

    // Greedy lane packing so tiles never overlap along the time axis.
    const laneEnd: number[] = [];
    const cards: Card[] = topics.map((t) => {
      const main = posU(Date.parse(t.due_at)) * mainLen;
      const s0 = Math.max(0, Math.min(main - extent / 2, mainLen - extent));
      let lane = laneEnd.findIndex((e) => s0 >= e + GAP);
      if (lane === -1) { lane = laneEnd.length; laneEnd.push(0); }
      laneEnd[lane] = s0 + extent;
      return { task: t, state: topicState(t, now), main, lane };
    });

    // Regular date ticks only in the horizontal time view; vertical shows dates in
    // the left gutter per card, so extra ticks would just clutter the spine.
    const ticks: Tick[] = [];
    if (scale === 'time' && isH) {
      const step = spanDays <= 20 ? 3 : spanDays <= 60 ? 7 : 14;
      const first = new Date(start); first.setHours(0, 0, 0, 0);
      for (let t = first.getTime(); t <= end; t += step * DAY) {
        const d = new Date(t);
        ticks.push({ u: posU(t), label: fmtDayMonth(d), today: sameDay(d, now) });
      }
    }

    return {
      mainLen, lanes: laneEnd.length || 1, cards, ticks,
      uReviewStart: posU(examMs - review * DAY), uExam: posU(examMs), uNow: posU(nowMs), review,
    };
  });

  const isH = $derived(orient === 'horizontal');
  const examDays = $derived(subject ? daysUntil(subject.exam_date, now) : 0);

  // px helpers — map (main position, lane) to concrete left/top per orientation.
  const cardW = $derived(isH ? CARD_W : CARD_W_V);
  const V_DOT = $derived(SPINE_X);               // spine/dot x in the vertical view
  const crossOf = (lane: number) => (isH ? AXIS_H : V_CARD_X) + lane * ((isH ? CARD_H : cardW) + GAP);
  function tileStyle(c: Card): string {
    const cross = crossOf(c.lane);
    if (isH) {
      const left = Math.max(0, Math.min(c.main - CARD_W / 2, layout.mainLen - CARD_W));
      return `left:${left}px; top:${cross}px; width:${CARD_W}px; height:${CARD_H}px`;
    }
    const top = Math.max(0, Math.min(c.main - CARD_H / 2, layout.mainLen - CARD_H));
    return `left:${cross}px; top:${top}px; width:${cardW}px; height:${CARD_H}px`;
  }
  function dotStyle(c: Card): string { return isH ? `left:${c.main}px; top:30px` : `top:${c.main}px; left:${V_DOT}px`; }
  function gutterStyle(c: Card): string { return `top:${c.main}px; width:${GUTTER - 12}px`; }
  function linkStyle(c: Card): string {
    const cross = crossOf(c.lane);
    return isH ? `left:${c.main}px; top:${AXIS_H}px; height:${cross - AXIS_H}px`
               : `top:${c.main}px; left:${V_DOT}px; width:${cross - V_DOT}px`;
  }
  function markerStyle(u: number): string { return isH ? `left:${u * layout.mainLen}px` : `top:${u * layout.mainLen}px`; }
  function bandStyle(): string {
    const a = layout.uReviewStart * layout.mainLen, b = layout.uExam * layout.mainLen;
    return isH ? `left:${a}px; width:${Math.max(0, b - a)}px` : `top:${a}px; height:${Math.max(0, b - a)}px`;
  }
  function tickStyle(u: number): string { return isH ? `left:${u * layout.mainLen}px` : `top:${u * layout.mainLen}px`; }
  function expStyle(c: Card): string {
    if (isH) {
      const left = Math.max(0, Math.min(c.main - EXP_W / 2, layout.mainLen - EXP_W));
      return `left:${left}px; top:${crossOf(c.lane)}px; width:${EXP_W}px`;
    }
    return `left:${crossOf(c.lane)}px; top:${Math.max(0, c.main - CARD_H / 2)}px; width:${EXP_W}px`;
  }
  // track box size (main axis + cross axis) in px
  const trackW = $derived(isH ? layout.mainLen : V_CARD_X + layout.lanes * (CARD_W_V + GAP) + V_PAD_R);
  const trackH = $derived(isH ? AXIS_H + layout.lanes * (CARD_H + GAP) + SLACK : layout.mainLen + SLACK);

  // Hover peek with a short intent delay (mirrors the agenda's expand-on-hover).
  // A short leave-grace lets the pointer cross the gap from tile to peek without flicker.
  let hover = $state<Card | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  function enter(c: Card) { clearTimeout(leaveTimer); clearTimeout(timer); timer = setTimeout(() => (hover = c), 220); }
  function leave() { clearTimeout(timer); clearTimeout(leaveTimer); leaveTimer = setTimeout(() => (hover = null), 90); }
</script>

{#snippet tile(c: Card, big: boolean)}
  <div class="chead">
    <span class="date">{fmtDayMonth(new Date(c.task.due_at))}</span>
    <span class="pill {c.task.status}">{STATUS_LABEL[c.task.status]()}</span>
  </div>
  <div class="ctitle" class:big>{c.task.title}</div>
  {#if big}
    {#if c.task.summary}<div class="csum md">{@html renderMarkdown(c.task.summary, taskRepo(c.task), $config)}</div>{/if}
    {#if c.task.last_note?.body}
      <p class="cnote"><Icon name="note" size={11} /> {c.task.last_note.body}</p>
    {/if}
  {/if}
{/snippet}

<div class="wrap">
  <div class="ctrls">
    <div class="seg" role="group">
      <button class:on={orient === 'horizontal'} onclick={() => (orient = 'horizontal')}>{m.tl_horizontal()}</button>
      <button class:on={orient === 'vertical'} onclick={() => (orient = 'vertical')}>{m.tl_vertical()}</button>
    </div>
    <div class="seg" role="group">
      <button class:on={scale === 'time'} onclick={() => (scale = 'time')}>{m.tl_scale_time()}</button>
      <button class:on={scale === 'even'} onclick={() => (scale = 'even')}>{m.tl_scale_even()}</button>
    </div>
    <div class="seg font" role="group" aria-label="Font size">
      {#each ZOOMS as z, i}
        <button class:on={zoom === z} onclick={() => (zoom = z)} style={`font-size:${12 + i * 2}px`} aria-label={`Font ${Math.round(z * 100)}%`}>A</button>
      {/each}
    </div>
  </div>

  <div class="scroll {orient}" bind:clientWidth={vw}>
    <div class="track {orient}" style={`width:${trackW}px; height:${trackH}px; --c:${meta.color}; --spine:${V_DOT}px; zoom:${zoom}`}>
      <span class="axis-line"></span>

      {#if layout.uExam > layout.uReviewStart}
        <span class="band review" style={bandStyle()}>
          <small class="band-tag">{m.study_review()} · {layout.review}{m.study_days_suffix()}</small>
        </span>
      {/if}
      {#if subject}
        <span class="marker exam" style={markerStyle(layout.uExam)}>
          <small class="mk-tag exam"><Icon name="calendar" size={11} /> {m.study_exam()} · {fmtDayMonth(new Date(subject.exam_date))}</small>
        </span>
      {/if}
      <span class="marker today" style={markerStyle(layout.uNow)}>
        <small class="mk-tag today">{m.study_today()}</small>
      </span>

      {#each layout.ticks as tk}
        <span class="tick" class:today={tk.today} style={tickStyle(tk.u)}><i></i><small>{tk.label}</small></span>
      {/each}

      {#each layout.cards as c (c.task.id)}
        {#if !isH}<span class="vdate" style={gutterStyle(c)}>{fmtDayMonth(new Date(c.task.due_at))}</span>{/if}
        <span class="dot {c.state}" class:on={hover?.task.id === c.task.id} style={dotStyle(c)}></span>
        <span class="link" style={linkStyle(c)}></span>
        <button class="card {c.state}" style={tileStyle(c)}
          onmouseenter={() => enter(c)} onmouseleave={leave} onfocus={() => enter(c)} onblur={leave}
          onclick={() => selectedTaskId.set(c.task.id)} aria-label={c.task.title}>
          {@render tile(c, false)}
        </button>
      {/each}

      {#if hover}
        <div class="scrim" transition:fade={{ duration: 120 }}></div>
        {@const c = hover}
        <div class="exp {c.state}" style={expStyle(c)} transition:fly={{ y: -6, duration: 140 }}
          role="group" onmouseenter={() => enter(c)} onmouseleave={leave} onfocusout={leave}>
          <button class="exp-hit" onclick={() => selectedTaskId.set(c.task.id)} aria-label={c.task.title}>
            {@render tile(c, true)}
          </button>
        </div>
      {/if}
    </div>
  </div>

  {#if subject && topics.length}
    <div class="foot">
      <span class="exam-chip" class:soon={examDays >= 0 && examDays <= 7} class:over={examDays < 0}>
        <Icon name="calendar" size={13} /> {m.study_exam()} {fmtDayMonth(new Date(subject.exam_date))}
        · {examDays === 0 ? m.study_today() : examDays < 0 ? `${-examDays}${m.study_days_suffix()} ${m.study_overdue()}` : `${m.study_in()} ${examDays}${m.study_days_suffix()}`}
      </span>
      <span class="legend"><i class="lg review"></i> {m.study_lg_review()}</span>
      <span class="legend"><i class="lg exam"></i> {m.study_lg_exam()}</span>
      <span class="legend"><i class="lg today"></i> {m.study_lg_today()}</span>
    </div>
  {/if}
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 10px; }
  .ctrls { display: flex; gap: 8px; }
  .seg { display: inline-flex; border: 1px solid var(--border-glass); border-radius: 7px; overflow: hidden; }
  .seg button { background: var(--bg-glass); border: none; color: var(--text-secondary); padding: 4px 11px; font-size: 12px; cursor: pointer; border-right: 1px solid var(--border-glass); }
  .seg button:last-child { border-right: none; }
  .seg button:hover { background: var(--bg-glass-hover); }
  .seg button.on { background: var(--accent-dim); color: var(--accent); font-weight: 600; }
  .seg.font button { display: inline-flex; align-items: center; padding: 2px 10px; font-weight: 700; line-height: 1; }

  .scroll.horizontal { overflow-x: auto; overflow-y: hidden; border-radius: 12px; padding-bottom: 4px; }
  .scroll.vertical { overflow: visible; display: flex; justify-content: center; }
  .track { position: relative; min-width: 100%; }
  .track.vertical { min-width: 0; }

  /* main time axis: top line (horizontal) or left spine (vertical) */
  .track.horizontal .axis-line { position: absolute; left: 0; right: 0; top: 30px; height: 2px; background: var(--border-glass); }
  .track.vertical .axis-line { position: absolute; top: 0; bottom: 0; left: var(--spine); width: 2px; background: var(--border-glass); transform: translateX(-1px); }

  /* date gutter (vertical): each topic's date, aligned to its dot, no overlap */
  .vdate { position: absolute; left: 0; text-align: right; transform: translateY(-50%); z-index: 2;
    font-size: 12px; font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }

  /* review band + exam/today guides span the full cross axis */
  .band.review { position: absolute; border-radius: 6px;
    background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--c) 16%, transparent) 0 7px, transparent 7px 14px); }
  .track.horizontal .band.review { top: 24px; bottom: 0; border-left: 1px dashed color-mix(in srgb, var(--c) 45%, transparent); }
  .track.vertical .band.review { left: calc(var(--spine) - 7px); right: 0; border-top: 1px dashed color-mix(in srgb, var(--c) 45%, transparent); }
  .band-tag { position: absolute; font-size: 10px; color: color-mix(in srgb, var(--c) 85%, var(--text-secondary));
    background: var(--bg-glass-hover); border: 1px solid var(--border-glass); border-radius: 5px; padding: 2px 6px; white-space: nowrap; }
  .track.horizontal .band-tag { top: -18px; left: 6px; }
  .track.vertical .band-tag { right: 6px; top: 6px; }

  .marker { position: absolute; z-index: 2; }
  .track.horizontal .marker { top: 24px; bottom: 0; width: 2px; transform: translateX(-1px); }
  .track.vertical .marker { left: calc(var(--spine) - 7px); right: 0; height: 2px; transform: translateY(-1px); }
  .marker.exam { background: var(--c); }
  .track.horizontal .marker.exam { width: 3px; border-radius: 2px; }
  .track.vertical .marker.exam { height: 3px; border-radius: 2px; }
  .marker.today { background: var(--text-primary); }
  .mk-tag { position: absolute; font-size: 10px; line-height: 1; padding: 2px 6px; border-radius: 5px; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px; z-index: 3; }
  .track.horizontal .mk-tag { top: -18px; left: 50%; transform: translateX(-50%); }
  .track.vertical .mk-tag { right: 8px; top: 50%; transform: translateY(-50%); }
  .mk-tag.exam { color: var(--c); background: color-mix(in srgb, var(--c) 15%, var(--bg-base)); border: 1px solid color-mix(in srgb, var(--c) 40%, transparent); }
  .mk-tag.today { color: var(--text-primary); background: var(--bg-glass-hover); border: 1px solid var(--border-glass); }
  .track.horizontal .mk-tag.today { left: auto; right: -4px; transform: none; }
  /* vertical: pull "today" out to the left margin, filled + bold so it reads clearly */
  .track.vertical .mk-tag.today { left: -8px; right: auto; transform: translate(-100%, -50%);
    background: var(--text-primary); color: var(--bg-base); border-color: transparent; font-weight: 700; font-size: 11px; }

  .tick { position: absolute; display: flex; align-items: center; gap: 2px; z-index: 1; }
  .track.horizontal .tick { top: 32px; transform: translateX(-50%); flex-direction: column; }
  .track.vertical .tick { left: 32px; transform: translateY(-50%); flex-direction: row; }
  .tick i { background: var(--border-glass); display: block; }
  .track.horizontal .tick i { width: 1px; height: 5px; }
  .track.vertical .tick i { width: 5px; height: 1px; }
  .tick small { font-size: 10px; color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .tick.today i { background: var(--text-primary); }
  .tick.today small { color: var(--text-primary); font-weight: 700; }

  .dot { position: absolute; width: 13px; height: 13px; border-radius: 50%; transform: translate(-50%, -50%);
    border: 2px solid var(--c); background: var(--bg-base); z-index: 3; transition: box-shadow 0.15s ease, transform 0.12s ease; }
  .dot.on { transform: translate(-50%, -50%) scale(1.25); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 25%, transparent); z-index: 5; }
  .dot.done { background: var(--c); }
  .dot.overdue { border-color: var(--red, #e06c6c); background: var(--red, #e06c6c); }
  .dot.pending { background: var(--bg-base); }
  .link { position: absolute; background: color-mix(in srgb, var(--c) 30%, transparent); z-index: 1; }
  .track.horizontal .link { width: 2px; transform: translateX(-1px); }
  .track.vertical .link { height: 2px; transform: translateY(-1px); }

  .card { position: absolute; text-align: left; z-index: 4; overflow: hidden; cursor: pointer;
    display: flex; flex-direction: column; gap: 5px; padding: 9px 11px; border-radius: 10px;
    background: var(--bg-base); border: 1px solid var(--border-glass); border-left: 3px solid var(--c);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24); transition: box-shadow 0.15s ease; }
  .card.overdue { border-left-color: var(--red, #e06c6c); }
  .chead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .chead .date { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .pill { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 2px 7px; border-radius: 999px; white-space: nowrap; }
  .pill.done { color: var(--green, #6bbf83); background: color-mix(in srgb, var(--green, #6bbf83) 18%, transparent); }
  .pill.in_progress { color: var(--amber, #e0a458); background: color-mix(in srgb, var(--amber, #e0a458) 20%, transparent); }
  .pill.pending { color: var(--text-muted); background: var(--bg-glass-hover); }
  .pill.snoozed { color: var(--text-muted); background: var(--bg-glass-hover); }
  .ctitle { font-size: 13px; font-weight: 700; color: var(--text-primary); line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ctitle.big { white-space: normal; font-size: 14px; }
  /* vertical: the date lives in the gutter, so drop it from tile AND peek headers */
  .track.vertical .chead .date { display: none; }
  .track.vertical .chead { justify-content: flex-end; }

  /* dim everything behind the open peek so neighbouring cards don't bleed through */
  .scrim { position: absolute; inset: 0; z-index: 15; pointer-events: none;
    background: color-mix(in srgb, var(--bg-base) 66%, transparent); }
  .exp { position: absolute; z-index: 20; border-radius: 11px;
    background: var(--bg-base); border: 1px solid var(--border-glass); border-left: 3px solid var(--c);
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5); }
  .exp.overdue { border-left-color: var(--red, #e06c6c); }
  .exp-hit { display: flex; flex-direction: column; gap: 7px; width: 100%; text-align: left; cursor: pointer; padding: 11px 13px; background: none; border: none; }
  .exp .csum { font-size: 12.5px; color: var(--text-secondary); line-height: 1.4; }
  .exp .csum.md :global(p) { margin: 0 0 4px; }
  .exp .csum.md :global(ul) { margin: 2px 0 0; padding-left: 16px; list-style: disc; }
  .exp .csum.md :global(li) { margin: 1px 0; }
  .exp .csum.md :global(strong) { color: var(--text-primary); }
  .exp .cnote { display: flex; gap: 5px; font-size: 11.5px; color: var(--text-muted); line-height: 1.35; padding: 6px 8px; background: var(--bg-glass-hover); border-radius: 7px; }

  .foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 2px 4px; }
  .exam-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--text-secondary);
    padding: 4px 9px; border-radius: 999px; background: var(--bg-glass-hover); border: 1px solid var(--border-glass); }
  .exam-chip.soon { color: var(--amber, #e0a458); }
  .exam-chip.over { color: var(--red, #e06c6c); }
  .legend { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); }
  .legend .lg { width: 14px; height: 9px; border-radius: 2px; display: inline-block; }
  .legend .lg.review { background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--text-secondary) 40%, transparent) 0 4px, transparent 4px 8px); }
  .legend .lg.exam { width: 3px; height: 13px; background: var(--accent); border-radius: 2px; }
  .legend .lg.today { width: 2px; height: 13px; background: var(--text-primary); }
</style>
