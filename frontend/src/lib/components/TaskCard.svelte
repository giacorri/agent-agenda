<script lang="ts">
  import type { Task } from '$lib/types';
  import { api } from '$lib/api';
  import { selectedTaskId, hoveredTaskId, linkPick } from '$lib/stores/tasks';
  import { showNotice } from '$lib/stores/view';
  import { renderMarkdown, splitNote } from '$lib/markdown';
  import { tagIcon } from '$lib/services';
  import { config, categoryMeta, personFor, clientFor, taskRepo } from '$lib/stores/config';
  import { isHidden } from '$lib/stores/scope';
  import { isOverdue, isOverdueBucket, relativeTime, hasDue } from '$lib/time';
  import { fmtDayNum, fmtTime, bucketLabel, bucketAgeLabel } from '$lib/format';
  import * as m from '$lib/paraglide/messages';
  import Icon from './Icon.svelte';
  import PersonAvatar from './PersonAvatar.svelte';
  import ClientLogo from './ClientLogo.svelte';

  // dense = tight context (week columns): day is already in the column header, and red/accent
  // already signal late/in-progress, so we drop the day, the tags, and the textual badges.
  // badgeBucket (compact view): the task's time bucket, rendered as a per-card pill
  // so the bucket is readable without a section header. Empty = sections view.
  // peek: keep the card a short, fixed-height "peek" of the content; on hover it
  // expands as an overlay (over the cards below, no reflow) to reveal the full text.
  let { task, compact = false, dense = false, badgeBucket = '', peek = false }:
    { task: Task; compact?: boolean; dense?: boolean; badgeBucket?: string; peek?: boolean } = $props();

  const badgeText = $derived(
    badgeBucket ? (isOverdueBucket(badgeBucket) ? bucketAgeLabel(badgeBucket) : bucketLabel(badgeBucket)) : ''
  );

  // Default repo for bare refs (#98, PR#98) in this task's text, from its tags/services.
  const repo = $derived(taskRepo(task));

  const overdue = $derived(isOverdue(task));
  const late = $derived(overdue);
  const inProgress = $derived(task.status === 'in_progress');
  const actionable = $derived(task.status === 'pending' || inProgress);
  // Open prerequisites; while non-empty the task is "blocked" (reminders are
  // already suppressed server-side, this just surfaces it).
  const blockedBy = $derived(task.blocked_by ?? []);
  // Still-open tasks this one blocks (the other direction of the link).
  const blocks = $derived(task.blocks ?? []);
  // Main-list cards carry a relations chip (at-a-glance marker); on hover AgendaView
  // draws connectors to the linked cards. Compact/dense cards keep the plain pill.
  const showRelations = $derived(!compact && !dense && (blockedBy.length > 0 || blocks.length > 0));

  // Latest note = the at-a-glance progress beat shown on the card.
  const lastNote = $derived(task.last_note ?? null);
  const lastSplit = $derived(lastNote ? splitNote(lastNote.body) : { headline: '', rest: '' });
  const noteCount = $derived(task.note_count ?? 0);
  const noteIcon = $derived(
    lastNote?.kind === 'file' ? 'file' : lastNote?.kind === 'link' ? 'link' : 'note'
  );

  // Footer labels: services first, then tags (not in dense). As many as fit on one row;
  // the rest fold into "+N" — the full list lives in the detail drawer.
  const svcAll = $derived((task.services ?? []).filter((s) => s && s.trim()));
  const tagAll = $derived((task.tags ?? []).filter((t) => t && t.trim() && t !== 'personal'));
  const labels = $derived([
    ...svcAll.map((key) => ({ kind: 'svc' as const, key })),
    ...(dense ? [] : tagAll.map((key) => ({ kind: 'tag' as const, key }))),
  ]);

  // How many labels fit is only knowable from rendered widths, so measure them (all
  // visible, unshrunk) and re-fit whenever the row resizes — e.g. when the buttons
  // appear on hover-expand and take part of it.
  let labelsEl = $state<HTMLElement>();
  let shown = $state(1);
  function fitLabels() {
    const el = labelsEl;
    if (!el) return;
    const chips = [...el.querySelectorAll<HTMLElement>('.chip:not(.more)')];
    el.classList.add('measuring');
    chips.forEach((c) => (c.hidden = false));
    const widths = chips.map((c) => c.offsetWidth);
    el.classList.remove('measuring');
    const GAP = 5, MORE = 36, avail = el.clientWidth;
    let used = 0, k = 0;
    for (; k < chips.length; k++) {
      const next = used + (k ? GAP : 0) + widths[k];
      if (next + (k < chips.length - 1 ? GAP + MORE : 0) > avail) break;
      used = next;
    }
    const n = Math.max(1, k);
    chips.forEach((c, i) => (c.hidden = i >= n));
    shown = n;
  }
  $effect(() => {
    const el = labelsEl;
    if (!el || !labels.length) return;
    const ro = new ResizeObserver(fitLabels);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const nextStep = $derived((task.steps ?? []).find((st) => st && st.trim()) ?? null);


  // The three postpone shortcuts (10m / 1h / tomorrow) collapse into one ⏰ button
  // that opens this menu, keeping the card footer compact.
  let snoozeMenu = $state(false);

  // Hover-intent expand (peek mode): the card only expands after the pointer has
  // rested on it for EXPAND_DELAY, so sweeping over cards on the way to the wanted
  // one doesn't fire a jumpy expand. Driving expand + neighbor-dimming off this
  // `expanded` flag (not :hover) means leaving the card clears it at once — so the
  // moment you move on, every card reads normally again for navigation.
  const EXPAND_DELAY = 1000;
  let expanded = $state(false);
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  function onEnter() {
    // Announce the hover so AgendaView can draw connectors to linked cards.
    if (!compact && !dense) hoveredTaskId.set(task.id);
    // Always peek-expand the hovered card (same as any other card); the connector
    // overlay recomputes each frame and falls back to edge chips for anything the
    // taller card pushes off-screen.
    if (peek) hoverTimer = setTimeout(() => { expanded = true; }, EXPAND_DELAY);
  }
  function onLeave() {
    if (!compact && !dense && $hoveredTaskId === task.id) hoveredTaskId.set(null);
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    expanded = false;
  }

  // Pick-from-agenda mode (see linkPick): a click links instead of opening. The
  // child's own card acts as "cancel". Rejections (cycle, duplicate) surface as a notice.
  const picking = $derived($linkPick !== null);
  const pickSelf = $derived(picking && $linkPick?.childId === task.id);
  async function pickAsBlocker() {
    const pick = $linkPick;
    if (!pick) return;
    linkPick.set(null);
    if (pick.childId !== task.id) {
      try { await api.addDep(pick.childId, task.id); }
      catch (err) { showNotice(m.pick_failed({ error: String(err) })); }
    }
    selectedTaskId.set(pick.childId);
  }

  function openDetail(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    if ((e.target as HTMLElement).closest('a')) return;
    if (picking) { (e.currentTarget as HTMLElement).blur(); pickAsBlocker(); return; }
    // The card is a tabindex=0 div, so the click focuses it. The detail drawer
    // doesn't take focus, so the card stays focused underneath — and any key press
    // in the drawer (Esc to close) flips Chrome into keyboard mode, leaving a focus
    // ring on the card after it closes. Drop the focus for pointer opens; keyboard
    // opens go through onkeydown and keep it, where the ring is wanted.
    (e.currentTarget as HTMLElement).blur();
    selectedTaskId.set(task.id);
  }

  // Copy the title to the clipboard; the button flips to a check for a moment as
  // the only feedback (a card has nowhere to surface an error, so failures are silent).
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  async function copyTitle(e: Event) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(task.title);
      copied = true;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = false; }, 1400);
    } catch { copied = false; }
  }

  async function markDone(e: Event) { e.stopPropagation(); await api.done(task.id); }
  async function snooze(e: Event, until: string) { e.stopPropagation(); snoozeMenu = false; await api.snooze(task.id, until); }
  async function remove(e: Event) { e.stopPropagation(); await api.remove(task.id); }
</script>

<div class="cell" class:peek class:expanded onmouseenter={onEnter} onmouseleave={onLeave}>
<div
  class="card glass"
  data-task-id={task.id}
  class:personal={isHidden(task, $config)}
  class:done={task.status === 'done'}
  class:shelved={task.status === 'shelved'}
  class:inprogress={inProgress}
  class:overdue
  class:blocked={blockedBy.length}
  class:compact
  class:picking
  class:pick-self={pickSelf}
  onclick={openDetail}
  onkeydown={(e) => { if (e.key === 'Enter') picking ? pickAsBlocker() : selectedTaskId.set(task.id); }}
  role="button"
  tabindex="0"
>
  <button class="del" onclick={remove} title={m.tc_delete()} aria-label={m.tc_delete()}><Icon name="trash" size={15} /></button>
  <div class="head">
    <!-- Date on top (nearly every task has one), icons under it; the title wraps around both. -->
    <div class="side">
      <span class="when-wrap">
        {#if !dense && late && !isOverdueBucket(badgeBucket)}
          <!-- Past its due time but not in a past bucket (e.g. due earlier today):
               read as late, not a calm "Today". -->
          <span class="badge-late">{m.overdue()}</span>
        {/if}
        <!-- Times are rarely meaningful here, so the pill shows just the date; the bucket
             keeps its colour and moves to the tooltip. -->
        {#if badgeBucket && !(late && !isOverdueBucket(badgeBucket))}
          <span class="age-badge age-{badgeBucket}" title={badgeText}>{hasDue(task) ? fmtDayNum(task.due_at) : badgeText}</span>
        {:else if hasDue(task)}
          <span class="when">{dense ? fmtTime(task.due_at) : fmtDayNum(task.due_at)}</span>
        {/if}
      </span>
      <span class="who">
        {#if task.requester}
          {@const person = personFor(task.requester, $config)}
          <a class="req" href={`/requester/${encodeURIComponent(person?.key ?? task.requester)}`} title={m.tc_requested_by({ who: person?.label ?? task.requester })} aria-label={m.tc_requested_by({ who: person?.label ?? task.requester })} onclick={(e) => e.stopPropagation()}><PersonAvatar photo={person?.photo} size={22} alt={person?.label ?? task.requester} /></a>
        {/if}
        {#if task.client}
          {@const cl = clientFor(task.client, $config)}
          <!-- Icons only: requester and client names live in the tooltip and the drawer. -->
          <a class="cli" aria-label={m.tc_for_client({ name: cl?.label ?? task.client })} href={`/client/${encodeURIComponent(cl?.key ?? task.client)}`} title={m.tc_for_client({ name: cl?.label ?? task.client })} onclick={(e) => e.stopPropagation()}>
            <ClientLogo logo={cl?.logo} size={cl?.logo ? 20 : 14} alt={cl?.label ?? task.client} />
          </a>
        {/if}
      </span>
    </div>
    <div class="title">
      <span class="title-text">{#if !dense && inProgress}<span class="badge-prog">{m.status_in_progress()}</span>{/if}{task.title}</span>
      <button class="copy-title" class:ok={copied} onclick={copyTitle}
        title={copied ? m.copy_done() : m.copy_title()} aria-label={m.copy_title()}>
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
    </div>
  </div>
  {#if showRelations}
    <!-- At-a-glance marker; on hover AgendaView draws connectors to the linked cards. -->
    <div class="rel-chip">
      {#if blockedBy.length}
        <span class="rel-badge blocked"><Icon name="lock" size={11} /> {m.tc_blocked()}{#if blockedBy.length > 1} {blockedBy.length}{/if}</span>
      {/if}
      {#if blocks.length}
        <span class="rel-badge blocks"><span class="arr down"><Icon name="arrow" size={11} /></span> {m.tc_blocks()} {blocks.length}</span>
      {/if}
    </div>
  {:else if blockedBy.length}
    <div class="blocked-tag" title={blockedBy.map((b) => b.title).join(', ')}>
      <Icon name="lock" size={12} /> {m.tc_blocked()}: {blockedBy.map((b) => b.title).join(', ')}
    </div>
  {/if}
  <div class="body">
  {#if task.summary}<div class="summary md">{@html renderMarkdown(task.summary, repo, $config)}</div>{/if}
  {#if lastNote}
    <div class="laststep">
      <span class="ls-rail"><Icon name={noteIcon} size={12} /></span>
      <div class="ls-main">
        {#if lastSplit.headline}
          <div class="ls-head md">{@html renderMarkdown(lastSplit.headline, repo, $config)}</div>
          <div class="ls-body md with-head">{@html renderMarkdown(lastSplit.rest, repo, $config)}</div>
        {:else}
          <div class="ls-body md">{@html renderMarkdown(lastNote.body, repo, $config)}</div>
        {/if}
        <div class="ls-meta">
          <span>{relativeTime(lastNote.created_at)}</span>
          {#if noteCount > 1}<span class="ls-count">{m.tc_steps_count({ count: noteCount })}</span>{/if}
        </div>
      </div>
    </div>
  {/if}
  {#if nextStep && !dense}
    <div class="next">
      <span class="next-ico"><Icon name="arrow" size={12} /></span>
      <span class="next-lbl">{m.tc_next_step()}</span>
      <span class="next-md md">{@html renderMarkdown(nextStep, repo, $config)}</span>
    </div>
  {/if}
  </div>
  {#if actionable || labels.length}
    <div class="actions">
      {#if actionable}
        <button class="act-done" onclick={markDone} title={m.tc_mark_done()}><Icon name="check" size={14} /> {m.tc_done()}</button>
      {/if}
      <span class="labels" bind:this={labelsEl}>
        {#each labels as l, i (l.kind + l.key)}
          {#if l.kind === 'svc'}
            {@const meta = categoryMeta(l.key, $config)}
            <a class="chip svc" hidden={i >= shown} href={`/service/${encodeURIComponent(l.key)}`} style={`--svc:${meta.color}`} title={meta.label} onclick={(e) => e.stopPropagation()}>
              <Icon name={meta.icon} size={13} /><span class="lbl">{meta.label}</span>
            </a>
          {:else}
            <a class="chip tag" hidden={i >= shown} href={`/tag/${encodeURIComponent(l.key)}`} onclick={(e) => e.stopPropagation()}><Icon name={tagIcon(l.key)} size={12} /><span class="lbl">#{l.key}</span></a>
          {/if}
        {/each}
        {#if labels.length > shown}
          <span class="chip more" title={labels.slice(shown).map((l) => (l.kind === 'tag' ? '#' : '') + l.key).join(' ')}>+{labels.length - shown}</span>
        {/if}
      </span>
      {#if actionable}
      <div class="snooze-wrap">
        <button class="act-snooze" onclick={(e) => { e.stopPropagation(); snoozeMenu = !snoozeMenu; }}
          title={m.tc_postpone()} aria-label={m.tc_postpone()} aria-haspopup="menu" aria-expanded={snoozeMenu}>
          <Icon name="clock" size={14} /><Icon name="chevron" size={13} />
        </button>
        {#if snoozeMenu}
          <div class="snooze-menu" role="menu">
            <button role="menuitem" onclick={(e) => snooze(e, '10m')} title={m.tc_snooze_10m()}><Icon name="clock" size={13} /> 10m</button>
            <button role="menuitem" onclick={(e) => snooze(e, '1h')} title={m.tc_snooze_1h()}><Icon name="clock" size={13} /> 1h</button>
            <button role="menuitem" onclick={(e) => snooze(e, 'tomorrow')} title={`${m.bucket_tomorrow()} ${$config.settings.default_remind_time ?? '09:30'}`}><Icon name="sunrise" size={13} /> {m.bucket_tomorrow()}</button>
            <button role="menuitem" onclick={(e) => snooze(e, '1w')} title={m.tc_snooze_1w()}><Icon name="calendar" size={13} /> 1w</button>
          </div>
        {/if}
      </div>
      {/if}
    </div>
  {/if}
  {#if snoozeMenu}
    <div class="snooze-backdrop" role="presentation" onclick={(e) => { e.stopPropagation(); snoozeMenu = false; }}></div>
  {/if}
</div>
</div>

<style>
  /* Without peek the wrapper is transparent, so the card stays the grid item and
     nothing changes for the other views. */
  .cell { display: contents; }
  .body { display: contents; }
  /* Themed ring for keyboard focus; the UA default blue clashes with the dark theme. */
  .card:focus { outline: none; }
  .card:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .card { position: relative; padding: 13px 14px; display: flex; flex-direction: column; gap: 7px; cursor: pointer; transition: background 0.15s; border-left: 3px solid transparent; }
  /* Pick-from-agenda mode: every card is a target (amber = the prerequisite colour);
     the task being linked is dimmed, clicking it just cancels. */
  .card.picking { cursor: crosshair; }
  .card.picking:hover { border-color: var(--amber-border); box-shadow: 0 0 0 2px var(--amber-dim); }
  .card.pick-self { opacity: 0.4; cursor: default; }
  .card.pick-self:hover { border-color: var(--border-glass); box-shadow: none; }

  /* peek: the cell reserves a short fixed height; the card fills it and clips the
     body (summary/chips/note). On hover the card grows to its natural height as an
     overlay over the cards below — height/width/background all transition, so it
     expands gradually. The card keeps overflow:hidden, so the growing box reveals
     the text smoothly as it opens. */
  .cell.peek { display: block; position: relative; height: var(--peek-h, 212px);
    transition: opacity 0.25s ease, filter 0.25s ease; }
  .cell.peek > .card { position: absolute; top: 0; left: 0; right: 0; height: var(--peek-h, 212px);
    overflow: hidden;
    transition: height 0.28s ease, left 0.28s ease, right 0.28s ease, background 0.25s ease, box-shadow 0.25s ease; }
  .cell.peek .body { display: flex; flex-direction: column; gap: 7px; flex: 1 1 auto; min-height: 0; overflow: hidden; }
  /* Base peek keeps the description to 3-4 lines; hover reveals the rest. */
  .cell.peek .summary { -webkit-line-clamp: 4; line-clamp: 4; }
  /* While one card is hovered, fade + blur the others so the active one is the
     clear focus (global: .list is owned by AgendaView, .cell by this component). */
  /* Dim/blur the neighbours only while a card is actually expanded (JS sets
     `.expanded` after the hover-intent delay, and clears it the instant the pointer
     leaves) — so moving away restores every card at once for clean navigation. */
  :global(.list:has(.cell.peek.expanded) .cell.peek:not(.expanded)) { opacity: 0.32; filter: blur(2px); }
  .cell.peek.expanded { z-index: 30; }
  /* Expanded: grow to full height, nudge a touch wider, lift to a distinct elevated
     background and a bright 2px ring + strong shadow so the edges read clearly. */
  .cell.peek.expanded > .card { height: auto; min-height: var(--peek-h, 212px); left: -10px; right: -10px; z-index: 30; background: #241b3b;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.42), 0 22px 48px rgba(0, 0, 0, 0.7); }
  .cell.peek.expanded .summary { -webkit-line-clamp: unset; line-clamp: unset; display: block; }
  .del { position: absolute; top: 9px; right: 9px; display: inline-flex; background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 2px; opacity: 0; transition: opacity 0.12s, color 0.12s; }
  .card:hover .del { opacity: 0.65; }
  .del:hover { color: var(--amber); opacity: 1; }
  .card:hover { background: var(--bg-glass-hover); }
  /* Personal tasks get a base cyan tint; status colors below still take precedence. */
  .card.personal { border-left-color: var(--personal-border); background: var(--personal-dim); }
  .card.done { opacity: 0.7; border-left-color: var(--green-border); background: var(--green-dim); }
  .card.done .title { text-decoration: line-through; text-decoration-color: var(--green); color: var(--text-secondary); }
  /* Shelved: closed like done but red — set aside, not completed. */
  .card.shelved { opacity: 0.7; border-left-color: var(--red-border); background: var(--red-dim); }
  .card.shelved .title { text-decoration: line-through; text-decoration-color: var(--red); color: var(--text-secondary); }
  /* in-progress accent border; overdue red must win when a task is both, so it comes last. */
  .card.inprogress { border-left-color: var(--accent); }
  .card.overdue { border-left-color: var(--red-border); background: var(--red-dim); }
  /* A personal task that's overdue gets its own magenta, not the work red. */
  .card.personal.overdue { border-left-color: var(--personal-over-border); background: var(--personal-over-dim); }
  /* Blocked: waiting on an open prerequisite. Dim the card and show a lock pill;
     reminders are already suppressed server-side. */
  .card.blocked { opacity: 0.62; }
  .card.blocked:hover { opacity: 0.85; }
  .blocked-tag { display: inline-flex; align-items: center; gap: 5px; align-self: flex-start;
    font-size: 11px; font-weight: 600; color: var(--amber, #d9a441);
    background: color-mix(in srgb, var(--amber, #d9a441) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--amber, #d9a441) 34%, transparent);
    border-radius: 999px; padding: 1px 8px; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Relations chip (main-list cards): at-a-glance badges; the connectors to linked
     cards are drawn by AgendaView on hover. */
  .rel-chip { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; align-self: flex-start; }
  .rel-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; border-radius: 999px; padding: 1px 8px; }
  .rel-badge.blocked { color: var(--amber, #d9a441); background: color-mix(in srgb, var(--amber, #d9a441) 14%, transparent); border: 1px solid color-mix(in srgb, var(--amber, #d9a441) 34%, transparent); }
  .rel-badge.blocks { color: var(--accent); background: var(--accent-dim); border: 1px solid var(--accent-border); }
  .arr { display: inline-flex; }
  .arr.down { transform: rotate(180deg); }
  .card.compact { padding: 9px 11px; gap: 4px; }
  .card.compact .act-done, .card.compact .snooze-wrap { display: none; }
  .card.compact .actions { padding-top: 2px; }
  /* Avatars, title and date share one row; side items stay pinned to the title's first line. */
  /* Date + icons float in the top-right corner and the title wraps around them: line 1
     makes room for the date, line 2 for the icons, later lines take the full width. So a
     title that wraps anyway fills the space beside the icons, and a short one stays on
     one line with the icons tucked underneath. Side rows match the title line height. */
  .head { flex: none; display: flow-root; font-size: 13px; color: var(--text-muted); padding-right: 22px; min-height: 22px; }
  .side { float: right; display: flex; flex-direction: column; align-items: flex-end; margin: 0 0 2px 10px; }
  .side:not(:has(a, .age-badge, .when, .badge-late)) { display: none; }
  .who { display: inline-flex; align-items: center; gap: 4px; height: 22px; }
  .who:not(:has(*)) { display: none; }
  .who:has(> :only-child) { align-self: center; }
  .when-wrap { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 3px; min-height: 22px; justify-content: center; }
  .when-wrap:not(:has(*)) { display: none; }
  .req { display: inline-flex; flex: none; border-radius: 999px; box-shadow: 0 0 0 1.5px var(--accent-border); text-decoration: none; }
  .req:hover { box-shadow: 0 0 0 2px var(--accent); }
  .req > :global(svg) { flex: none; }
  /* Client reads as a neutral chip, so it never competes with the accent requester one. */
  .cli { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 22px; height: 22px; color: var(--text-secondary); background: var(--bg-glass-hover); border: 1px solid var(--border-glass); border-radius: 7px; overflow: hidden; text-decoration: none; }
  .cli:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .cli > :global(svg), .cli > :global(img) { flex: none; }
  .when { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--text-secondary); }
  .badge-late { color: var(--red); font-size: 11px; font-weight: 600; white-space: nowrap; }
  .card.personal .badge-late { color: var(--personal-over); }
  .badge-prog { color: var(--accent); font-size: 11px; font-weight: 600; white-space: nowrap; margin-right: 6px; vertical-align: 2px; }
  /* Compact-view bucket pill. Overdue fades from light to solid red as it ages;
     future buckets stay neutral, with today accented. */
  .age-badge { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 0.03em; text-transform: uppercase; padding: 1px 7px; border-radius: 999px; white-space: nowrap; border: 1px solid transparent; }
  .age-yesterday { background: color-mix(in srgb, var(--red) 18%, transparent); color: var(--red); }
  .age-earlier_this_week { background: color-mix(in srgb, var(--red) 34%, transparent); color: #fff; }
  .age-last_week { background: color-mix(in srgb, var(--red) 56%, transparent); color: #fff; }
  .age-earlier { background: var(--red); color: #fff; }
  .age-today { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
  .age-tomorrow, .age-this_week, .age-later { background: var(--bg-glass); color: var(--text-muted); border-color: var(--border-glass); }
  /* Personal overdue cards lean magenta, so match the badge to the card. */
  .card.personal .age-yesterday { background: color-mix(in srgb, var(--personal-over) 20%, transparent); color: var(--personal-over); }
  .card.personal .age-earlier_this_week { background: color-mix(in srgb, var(--personal-over) 38%, transparent); color: #fff; }
  .card.personal .age-last_week { background: color-mix(in srgb, var(--personal-over) 58%, transparent); color: #fff; }
  .card.personal .age-earlier { background: var(--personal-over); color: #fff; }
  .title { font-size: 16px; font-weight: 600; color: var(--text-primary); line-height: 22px; text-wrap: pretty; overflow-wrap: anywhere; }
  /* Faint at rest so it doesn't compete with the title; lit on card hover, and kept
     visible while the card is peek-expanded (where it's a deliberate target). */
  .copy-title { display: inline-flex; vertical-align: -2px; margin-left: 4px; padding: 1px 3px; background: transparent; border: none; color: var(--text-muted);
    text-decoration: none; opacity: 0; transition: opacity 0.12s, color 0.12s; }
  .card:hover .copy-title, .cell.expanded .copy-title { opacity: 0.6; }
  .copy-title:hover { background: transparent; color: var(--accent); opacity: 1; }
  .copy-title.ok { color: var(--green); opacity: 1; }
  .summary { font-size: 14px; color: var(--text-secondary); line-height: 1.45; overflow-wrap: anywhere; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 6; line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
  .card.compact .summary { -webkit-line-clamp: 2; }
  /* The fixed-height peek keeps only title + latest note: the rest would be sliced
     mid-line by the clip, so it shows on hover-expand only. */
  .cell.peek:not(.expanded) .summary,
  .cell.peek:not(.expanded) .next,
  .cell.peek:not(.expanded) .rel-chip,
  .cell.peek:not(.expanded) .blocked-tag { display: none; }
  /* Nobody clicks while scrolling past: the preview drops every button (delete, copy,
     done, snooze) and the room reserved for them; they appear once the card expands. */
  .cell.peek:not(.expanded) :is(.del, .copy-title, .act-done, .snooze-wrap) { display: none; }
  .cell.peek:not(.expanded) .head { padding-right: 0; }
  .summary.md :global(p) { margin: 0; }
  .summary.md :global(a) { color: var(--link); }
  .summary.md :global(a:hover) { color: var(--link-hover); }
  .summary.md :global(code) { background: var(--bg-glass-hover); padding: 1px 4px; border-radius: 3px; font-size: 13px; }
  .summary.md :global(strong) { color: var(--text-primary); }
  .summary.md :global(ul), .summary.md :global(ol) { margin: 2px 0 0; padding-left: 18px; }
  .summary.md :global(ul) { list-style: disc; }
  .summary.md :global(ol) { list-style: decimal; }
  .summary.md :global(li) { margin: 1px 0; }
  .labels { display: flex; flex: 1 1 0; align-items: center; gap: 5px; min-width: 0; overflow: hidden; }
  .labels .chip:first-child { flex: 0 1 auto; }
  /* Added from JS only, so it must be :global or Svelte prunes it as unused. */
  .labels:global(.measuring) .chip { flex: none; }
  .labels .chip[hidden] { display: none; }
  .labels .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip { flex: none; min-width: 0; font-size: 12px; padding: 2px 8px; border-radius: 999px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
  .chip.svc { background: color-mix(in srgb, var(--svc, var(--accent)) 14%, transparent); border: 1px solid color-mix(in srgb, var(--svc, var(--accent)) 38%, transparent); color: var(--svc, var(--accent)); font-weight: 500; }
  .chip.svc:hover { background: color-mix(in srgb, var(--svc, var(--accent)) 22%, transparent); }
  .chip.tag { background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-muted); }
  .chip.tag:hover { background: var(--bg-glass-hover); color: var(--text-secondary); }
  .chip.more { background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-muted); cursor: default; }
  .laststep { display: flex; gap: 8px; margin-top: 2px; padding: 7px 9px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-left: 2px solid var(--accent-border); border-radius: 5px; }
  .ls-rail { display: inline-flex; align-items: flex-start; color: var(--accent); padding-top: 1px; flex-shrink: 0; }
  .ls-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .ls-head { font-size: 13px; font-weight: 600; color: var(--text-primary); line-height: 1.4; overflow-wrap: anywhere; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .card.compact .ls-head { -webkit-line-clamp: 1; }
  .ls-head.md :global(p) { margin: 0; }
  .ls-head.md :global(a) { color: var(--link); }
  .ls-head.md :global(code) { background: var(--bg-glass-hover); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .ls-head.md :global(strong) { color: var(--text-primary); }
  .ls-body { font-size: 13px; color: var(--text-secondary); line-height: 1.4; overflow-wrap: anywhere; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .ls-body.with-head { -webkit-line-clamp: 1; color: var(--text-muted); }
  .card.compact .ls-body { -webkit-line-clamp: 1; }
  .card.compact .ls-body.with-head { display: none; }
  .ls-body.md :global(p) { margin: 0; }
  .ls-body.md :global(a) { color: var(--link); }
  .ls-body.md :global(code) { background: var(--bg-glass-hover); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .ls-body.md :global(strong) { color: var(--text-primary); }
  .ls-body.md :global(ul), .ls-body.md :global(ol) { margin: 0; padding-left: 16px; }
  .ls-meta { display: flex; gap: 8px; font-size: 11px; color: var(--text-muted); }
  .ls-count { color: var(--accent); }
  /* Forward beat under the backward one: what happens next, one line. */
  .next { display: flex; align-items: baseline; gap: 6px; font-size: 13px; color: var(--text-secondary); min-width: 0; }
  .next-ico { display: inline-flex; color: var(--green); transform: rotate(90deg); flex: none; align-self: center; }
  .next-lbl { font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; color: var(--green); flex: none; }
  .next-md { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .next-md :global(p) { display: inline; margin: 0; }
  .next-md :global(code) { background: var(--bg-glass-hover); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .next-md :global(a) { color: var(--link); }
  /* margin-top:auto pins the footer to the card bottom, so equal-height cards in a
     row (the grid stretches them) line their Done/⏰ controls up on one baseline. */
  .actions { display: flex; align-items: center; gap: 6px; margin-top: auto; padding-top: 6px; }
  button { display: inline-flex; align-items: center; gap: 5px; background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 5px 9px; border-radius: 4px; font-size: 13px; cursor: pointer; }
  button:hover { background: var(--bg-glass-hover); }
  .del:hover { background: transparent; }

  /* Single postpone control, pushed to the bottom-right; opens a small upward menu. */
  .snooze-wrap { position: relative; margin-left: auto; display: inline-flex; }
  .act-snooze { gap: 2px; padding: 5px 7px; color: var(--text-secondary); }
  .act-snooze:hover { color: var(--text-primary); }
  .snooze-backdrop { position: fixed; inset: 0; z-index: 40; }
  .snooze-menu { position: absolute; bottom: calc(100% + 5px); right: 0; z-index: 50; display: flex; flex-direction: column; min-width: 116px; padding: 4px; background: var(--bg-dark, #0f0f1a); border: 1px solid var(--border-glass); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
  .snooze-menu button { width: 100%; justify-content: flex-start; background: transparent; border: none; border-radius: 5px; padding: 7px 9px; color: var(--text-secondary); }
  .snooze-menu button:hover { background: var(--bg-glass-hover); color: var(--text-primary); }
</style>
