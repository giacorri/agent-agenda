<script lang="ts">
  import { tasks, hoveredTaskId } from '$lib/stores/tasks';
  import { scopeFilter, activeScopeIsHidden } from '$lib/stores/scope';
  import { searchFilter, searchActive, query } from '$lib/stores/search';
  import { configured, configLoaded } from '$lib/stores/config';
  import TaskCard from './TaskCard.svelte';
  import Dashboard from './Dashboard.svelte';
  import FirstRun from './FirstRun.svelte';
  import Icon from './Icon.svelte';
  import type { Task } from '$lib/types';
  import { bucket, BUCKET_ORDER, isOverdueBucket, isClosed, cmpDue, cmpInserted } from '$lib/time';
  import { bucketLabel } from '$lib/format';
  import { viewMode, peekMode, creatingId, formingId } from '$lib/stores/view';
  import * as m from '$lib/paraglide/messages';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';

  // Card motion: soft ease-out, ~.3s. On add, neighbours
  // slide to make room (flip) while the new card lands in place (pop). Honour
  // reduced-motion by collapsing durations to 0.
  const reduce = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Don't animate the initial load settle (list fetch, config, first WS snapshot) —
  // only user actions once the page is stable. 700ms covers a fast local
  // fetch; raise if a slow feed still shuffles the opening cards.
  let ready = $state(false);
  onMount(() => {
    const t = setTimeout(() => (ready = true), 700);
    return () => clearTimeout(t);
  });
  const flipCfg = $derived(ready && !reduce ? { duration: 950, easing: cubicOut } : { duration: 0 });
  // The just-born card must NOT flip: it would animate from a 0,0 box, and that transient
  // transform corrupts the slot rect FlyingCard reads for the flight. Only neighbours flip.
  const slotFlip = (id: string) =>
    (id === get(creatingId) || id === get(formingId)) ? { duration: 0 } : flipCfg;
  // `|local` on the each keeps this from firing for every card on first mount —
  // only cards added to an already-live list animate in.
  function pop(node: Element, { duration = 580 } = {}) {
    // A card born from the modal is animated by the View Transitions morph instead —
    // skip the pop so the two don't fight.
    const id = node.querySelector('[data-task-id]')?.getAttribute('data-task-id');
    if (!ready || reduce || (id && id === get(creatingId))) return { duration: 0 };
    return {
      duration,
      easing: cubicOut,
      css: (t: number, u: number) =>
        `opacity:${t}; transform: translateY(${u * 10}px) scale(${0.94 + 0.06 * t})`,
    };
  }

  // Fresh install (config loaded, nothing configured) → branded welcome instead
  // of the bare empty agenda.
  const firstRun = $derived($configLoaded && !$configured);

  let grouped = $derived.by(() => {
    const groups: Record<string, Task[]> = {};
    for (const t of $tasks) {
      if (!$scopeFilter(t) || !$searchFilter(t)) continue;
      // done + shelved collapse into one "Closed" section, coloured per status on the card.
      const key = isClosed(t) ? 'closed' : bucket(t);
      (groups[key] ??= []).push(t);
    }
    // General (no-deadline) tasks sort by insertion date; dated buckets by due date.
    for (const k of Object.keys(groups)) groups[k].sort(k === 'general' ? cmpInserted : cmpDue);
    return groups;
  });

  // Compact view: every non-done task flattened into one chronological list
  // (BUCKET_ORDER runs oldest → latest), each tagged with its bucket for the badge.
  let activeCards = $derived.by(() => {
    const out: { t: Task; bucket: string }[] = [];
    for (const k of BUCKET_ORDER) {
      if (k === 'done') continue;
      for (const t of grouped[k] ?? []) out.push({ t, bucket: k });
    }
    return out;
  });

  // Compact view splits at the deadline boundary: dated tasks, then a divider, then
  // the no-deadline backlog. Sections view uses headers instead, so it doesn't split.
  let datedCards = $derived(activeCards.filter((c) => c.bucket !== 'general'));
  let generalCards = $derived(activeCards.filter((c) => c.bucket === 'general'));

  // Closed tasks live in a collapsed "Archive" section, out of the normal agenda.
  let showArchive = $state(false);

  const total = $derived($tasks.filter((t) => $scopeFilter(t) && $searchFilter(t)).length);

  // ---- Dependency chain connectors --------------------------------------------
  // Hovering a card lights up its whole dependency subgraph — every prerequisite
  // upstream and every dependent downstream, transitively — and draws an arrow per
  // edge, always pointing prerequisite → dependent. One colour throughout: the
  // arrowhead (not the colour) tells you the direction, so a link reads the same
  // whichever end you hover. Lines live in an SVG overlay spanning the whole scroll
  // content; a rAF loop recomputes the geometry each frame so scroll / resize can't
  // desync them. Chain cards are ringed + lifted; everything else fades.
  let agendaEl: HTMLElement;
  let segs = $state<{ d: string }[]>([]);              // on-screen connector paths
  let chips = $state<{ x: number; y: number; label: string }[]>([]); // off-screen node markers
  let svgW = $state(0);
  let svgH = $state(0);

  type Box = { x: number; y: number; w: number; h: number };
  // Card box in the scroll-content coordinate system (origin = top-left of content).
  function boxOf(el: HTMLElement, cRect: DOMRect, sx: number, sy: number): Box {
    const r = el.getBoundingClientRect();
    return { x: r.left - cRect.left + sx, y: r.top - cRect.top + sy, w: r.width, h: r.height };
  }
  // Point where the ray from a box's centre toward (tx,ty) crosses the box border,
  // so lines attach to card edges cleanly for near, far and diagonal neighbours.
  function edge(b: Box, tx: number, ty: number) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const s = 1 / Math.max(Math.abs(dx) / (b.w / 2), Math.abs(dy) / (b.h / 2));
    return { x: cx + dx * s, y: cy + dy * s };
  }
  function pathBetween(from: Box, to: Box): string {
    const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
    const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
    const p1 = edge(from, tc.x, tc.y);
    const p2 = edge(to, fc.x, fc.y);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    // Bow with a floor so even edge-to-edge adjacent cards get a visible arc, capped so
    // distant links don't balloon; it clears the cards in between.
    const off = Math.max(30, Math.min(72, len * 0.22));
    const mx = (p1.x + p2.x) / 2 - (dy / len) * off;
    const my = (p1.y + p2.y) / 2 + (dx / len) * off;
    return `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  // Where the segment from-centre → to-centre leaves the (inset) viewport rect —
  // used to pin an off-screen node's arrow + label to the edge it lies beyond.
  function viewExit(x0: number, y0: number, x1: number, y1: number,
                    rx0: number, ry0: number, rx1: number, ry1: number) {
    const dx = x1 - x0, dy = y1 - y0;
    let t = 1;
    if (dx > 0) t = Math.min(t, (rx1 - x0) / dx); else if (dx < 0) t = Math.min(t, (rx0 - x0) / dx);
    if (dy > 0) t = Math.min(t, (ry1 - y0) / dy); else if (dy < 0) t = Math.min(t, (ry0 - y0) / dy);
    t = Math.max(0, Math.min(1, t));
    return { x: x0 + dx * t, y: y0 + dy * t };
  }

  // Transitive dependency subgraph reachable from the hovered card, both directions.
  // Edges are stored as prerequisite → dependent. Cycles can't exist (the API rejects
  // them), so plain BFS with a visited set terminates.
  function subgraph(rootId: string, byId: Map<string, Task>) {
    const nodes = new Set<string>([rootId]);
    const edges: { from: string; to: string }[] = [];
    const seen = new Set<string>();
    const addEdge = (from: string, to: string) => {
      const k = from + '>' + to;
      if (!seen.has(k)) { seen.add(k); edges.push({ from, to }); }
    };
    const up = [rootId];
    while (up.length) {
      const t = byId.get(up.pop()!); if (!t) continue;
      for (const b of t.blocked_by ?? []) { addEdge(b.id, t.id); if (!nodes.has(b.id)) { nodes.add(b.id); up.push(b.id); } }
    }
    const down = [rootId];
    while (down.length) {
      const t = byId.get(down.pop()!); if (!t) continue;
      for (const b of t.blocks ?? []) { addEdge(t.id, b.id); if (!nodes.has(b.id)) { nodes.add(b.id); down.push(b.id); } }
    }
    return { nodes, edges };
  }

  let marked: HTMLElement[] = [];
  function unmark() {
    for (const el of marked) el.classList.remove('conn-src', 'conn-node');
    marked = [];
  }
  const cardEl = (id: string): HTMLElement | null =>
    agendaEl?.querySelector(`[data-task-id="${id}"]`) ?? null;

  $effect(() => {
    const id = $hoveredTaskId;
    const all = $tasks; // re-run if the feed changes (e.g. a link is added live)
    unmark();
    segs = []; chips = [];
    if (!id || !agendaEl) return;
    const byId = new Map(all.map((t) => [t.id, t]));
    if (!byId.has(id)) return;
    const g = subgraph(id, byId);
    if (g.edges.length === 0) return; // not part of any dependency chain

    for (const nid of g.nodes) {
      const el = cardEl(nid); if (!el) continue;
      el.classList.add(nid === id ? 'conn-src' : 'conn-node');
      marked.push(el);
    }

    let raf = 0;
    const tick = () => {
      const cRect = agendaEl.getBoundingClientRect();
      svgW = agendaEl.clientWidth;
      svgH = agendaEl.scrollHeight;
      const sx = agendaEl.scrollLeft, sy = agendaEl.scrollTop;
      const vx0 = sx, vy0 = sy, vx1 = sx + agendaEl.clientWidth, vy1 = sy + agendaEl.clientHeight;
      const m = 16; // keep edge chips fully inside the viewport
      const boxCache = new Map<string, Box | null>();
      const getBox = (nid: string): Box | null => {
        if (boxCache.has(nid)) return boxCache.get(nid)!;
        const el = cardEl(nid);
        const b = el ? boxOf(el, cRect, sx, sy) : null;
        boxCache.set(nid, b); return b;
      };
      const onScreen = (b: Box) => {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        return cx >= vx0 && cx <= vx1 && cy >= vy0 && cy <= vy1;
      };
      const S: typeof segs = [];
      const C: typeof chips = [];
      for (const e of g.edges) {
        const fb = getBox(e.from), tb = getBox(e.to);
        if (!fb || !tb) continue;
        // The hovered card is the anchor: treat it as on-screen even if peek-expansion
        // pushed its centre past the fold, so it never collapses to an edge chip.
        const fOn = e.from === id ? true : onScreen(fb);
        const tOn = e.to === id ? true : onScreen(tb);
        if (fOn && tOn) {
          S.push({ d: pathBetween(fb, tb) }); // arrow at the dependent (to) end
        } else if (fOn || tOn) {
          // One end off-screen: stub from the on-screen card to the viewport border it
          // lies beyond, plus a labelled chip. Arrow keeps pointing prerequisite → dependent.
          const on = fOn ? fb : tb;
          const off = fOn ? tb : fb;
          const offId = fOn ? e.to : e.from;
          const oc = { x: off.x + off.w / 2, y: off.y + off.h / 2 };
          const nc = { x: on.x + on.w / 2, y: on.y + on.h / 2 };
          const p0 = edge(on, oc.x, oc.y);
          const ex = viewExit(nc.x, nc.y, oc.x, oc.y, vx0 + m, vy0 + m, vx1 - m, vy1 - m);
          const d = fOn
            ? `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} L ${ex.x.toFixed(1)} ${ex.y.toFixed(1)}`
            : `M ${ex.x.toFixed(1)} ${ex.y.toFixed(1)} L ${p0.x.toFixed(1)} ${p0.y.toFixed(1)}`;
          S.push({ d });
          C.push({ x: ex.x, y: ex.y, label: byId.get(offId)?.title ?? '' });
        }
        // both ends off-screen: nothing visible to draw
      }
      segs = S; chips = C;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); unmark(); segs = []; chips = []; };
  });
</script>

<div class="agenda" class:linking={segs.length > 0 || chips.length > 0} bind:this={agendaEl}>
  {#if segs.length}
    <svg class="conns" width={svgW} height={svgH} style="width:{svgW}px;height:{svgH}px" aria-hidden="true">
      <defs>
        <marker id="conn-arrow" markerWidth="11" markerHeight="11" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M1.5 1.5 L9 5 L1.5 8.5 Z" fill="context-stroke" />
        </marker>
      </defs>
      {#each segs as s, i (i)}
        <path class="conn" d={s.d} marker-end="url(#conn-arrow)" />
      {/each}
    </svg>
  {/if}
  {#each chips as c, i (i)}
    <div class="conn-chip" style="left:{c.x}px; top:{c.y}px">{c.label}</div>
  {/each}
  {#if firstRun && total === 0}
    <FirstRun />
  {:else}
    {#if $searchActive}
      <!-- While searching the view is a result list: the dashboard's global counters
           would contradict it, so they step aside for a plain result header. -->
      <p class="results">{m.search_results({ n: total, q: $query })}</p>
    {:else}
      <Dashboard />
    {/if}

    {#if $viewMode === 'compact'}
      {#if datedCards.length}
        <div class="list">
          {#each datedCards as c (c.t.id)}
            <div class="card-slot" class:creating={c.t.id === $creatingId} class:forming={c.t.id === $formingId} animate:flip={slotFlip(c.t.id)} in:pop|local>
              <TaskCard task={c.t} badgeBucket={c.bucket} peek={$peekMode} />
            </div>
          {/each}
        </div>
      {/if}
      {#if generalCards.length}
        <div class="divider"><span>{bucketLabel('general')}</span></div>
        <div class="list">
          {#each generalCards as c (c.t.id)}
            <div class="card-slot" class:creating={c.t.id === $creatingId} class:forming={c.t.id === $formingId} animate:flip={slotFlip(c.t.id)} in:pop|local>
              <TaskCard task={c.t} peek={$peekMode} />
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      {#each BUCKET_ORDER as group}
        {#if group !== 'done' && grouped[group]?.length}
          <section class:overdue={isOverdueBucket(group)} class:general={group === 'general'}>
            <h2>{bucketLabel(group)}</h2>
            <div class="list">
              {#each grouped[group] as t (t.id)}
                <div class="card-slot" class:creating={t.id === $creatingId} class:forming={t.id === $formingId} animate:flip={slotFlip(t.id)} in:pop|local>
                  <TaskCard task={t} peek={$peekMode} />
                </div>
              {/each}
            </div>
          </section>
        {/if}
      {/each}
    {/if}

    {#if grouped['closed']?.length}
      <section class="archive">
        <button class="arch-head" class:open={showArchive} onclick={() => (showArchive = !showArchive)} aria-expanded={showArchive}>
          <Icon name="chevron" size={14} />
          {m.archive()} <span class="arch-count">{grouped['closed'].length}</span>
        </button>
        <!-- A search reaches closed tasks too: opening the archive on its own keeps
             those hits from staying invisible behind the collapsed header. -->
        {#if showArchive || $searchActive}
          <div class="list">
            {#each grouped['closed'] as t (t.id)}
              <div class="card-slot" class:creating={t.id === $creatingId} class:forming={t.id === $formingId} animate:flip={slotFlip(t.id)} in:pop|local>
                <TaskCard task={t} peek={$peekMode} />
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    {#if total === 0}
      <p class="empty">
        {#if $searchActive}
          {m.search_none({ q: $query })}
        {:else}
          {$activeScopeIsHidden ? m.empty_personal() : m.empty_tasks()}
        {/if}
      </p>
    {/if}
  {/if}
</div>

<style>
  /* Horizontal gutter so a hovered card that grows slightly wider (and the dim/blur
     of neighbours) has room on both sides instead of being clipped by the scroll
     box against the sidebar. */
  .agenda { position: relative; display: flex; flex-direction: column; gap: 24px; overflow-y: auto; padding: 0 14px; }

  /* Dependency chain overlay: spans the full scroll content, never intercepts pointer
     events, sits above the cards. One colour throughout — direction is the arrowhead. */
  .conns { position: absolute; top: 0; left: 0; z-index: 40; pointer-events: none; overflow: visible; }
  .conn { fill: none; stroke: var(--amber, #d9a441); stroke-width: 2.5; stroke-linecap: round; opacity: 0.95; }
  /* Chip pinned to the viewport edge an off-screen chain card lies beyond. */
  .conn-chip { position: absolute; z-index: 41; transform: translate(-50%, -50%); pointer-events: none;
    max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px;
    color: var(--amber, #d9a441); border: 1px solid var(--amber, #d9a441);
    background: var(--bg-dark, #0f0f1a); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55); }

  /* Chain cards get lifted + ringed (not full-expanded like the hovered card); the
     hovered card gets a brighter ring so it reads as the pivot. */
  :global(.card.conn-node), :global(.card.conn-src) {
    z-index: 15; transition: box-shadow 0.15s ease, transform 0.15s ease;
    transform: translateY(-3px) scale(1.015); }
  :global(.card.conn-node) { box-shadow: 0 0 0 2px color-mix(in srgb, var(--amber, #d9a441) 75%, transparent), 0 12px 28px rgba(0, 0, 0, 0.5); }
  :global(.card.conn-src) { z-index: 16; box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--amber, #d9a441), 0 14px 30px rgba(0, 0, 0, 0.55); }
  /* While a chain is shown, fade the cards that aren't part of it. */
  .agenda.linking :global(.card:not(.conn-src):not(.conn-node)) {
    opacity: 0.32; transition: opacity 0.15s ease; }
  /* Keep chain cells fully visible even when peek would dim the others. */
  :global(.list .cell.peek:has(.conn-src)),
  :global(.list .cell.peek:has(.conn-node)) { opacity: 1 !important; filter: none !important; }

  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 10px; }
  /* Overdue sections read as late: red header with a leading marker dot. */
  section.overdue h2 { color: var(--red); display: flex; align-items: center; gap: 7px; }
  section.overdue h2::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--red); }
  /* General (no-deadline) backlog reads as lower-priority: dimmer header + softer cards. */
  section.general h2 { opacity: 0.6; }
  section.general :global(.card) { opacity: 0.82; }

  /* Compact-view boundary between dated tasks and the no-deadline backlog:
     a quiet label with faint hairlines, kept tight so the groups stay close. */
  /* Negative margins pull against the .agenda container's 24px row-gap on each
     side, halving the total space between the dated and general groups. */
  .divider { display: flex; align-items: center; gap: 10px; margin: -14px 2px; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border-glass); opacity: 0.35; }
  .divider span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; color: var(--text-muted); opacity: 0.5; }

  /* Closed tasks: collapsed archive, out of the normal agenda. */
  .archive { margin-top: 30px; }
  .arch-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 2px; background: none; border: none;
    font: inherit; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--text-muted); cursor: pointer; }
  .arch-head:hover { color: var(--text-primary); }
  .arch-head :global(svg) { transition: transform 0.15s ease; transform: rotate(-90deg); }
  .arch-head.open :global(svg) { transform: rotate(0deg); }
  .arch-count { opacity: 0.55; font-weight: 500; }
  .archive .list { margin-top: 12px; }
  /* Cards in a row share the tallest height; each card's summary grows (fill) to
     absorb the slack, so equal heights don't leave gaps under the text. */
  .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; align-items: stretch; }
  /* Wrapper carries the flip + entrance transition (Svelte directives can't sit on a
     component). display:grid gives it a real box that stretches the card to the row
     height, so equal-height rows and the peek overlay layout are unchanged. */
  .card-slot { display: grid; }
  /* While a card is morphing out of the modal (View Transition), keep the real card
     hidden in the "before" snapshot so it reads as the modal turning into it, not the
     modal landing on an already-visible card. Revealed when the transition starts. */
  .card-slot.creating { opacity: 0; }
  /* While the ghost takes shape at the modal, keep the real card out of the layout so
     neighbours don't make room until the flight begins. */
  .card-slot.forming { display: none; }
  .empty { color: var(--text-muted); }
  /* Search header, in the slot the dashboard leaves free. */
  .results { font-size: 13px; color: var(--text-muted); }
</style>
