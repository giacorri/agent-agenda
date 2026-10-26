<script lang="ts">
  // Read-only, phone-width view of one task, meant for a narrow side pane (the cmux
  // focus hook opens it next to the agent). Notes scroll as the journal; the first
  // step is pinned at the bottom. Steps carry no "done" flag, so a step counts as
  // completed when it leaves the head of the list without staying elsewhere in it.
  import { onMount, tick } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { page } from '$app/state';
  import { api } from '$lib/api';
  import { onWs } from '$lib/ws';
  import { renderMarkdown, splitNote } from '$lib/markdown';
  import { config, personFor, clientFor, taskRepo } from '$lib/stores/config';
  import { hasDue, isPastDue } from '$lib/time';
  import { fmtDueNum, fmtDayNum, statusLabel } from '$lib/format';
  import * as m from '$lib/paraglide/messages';
  import PersonAvatar from '$lib/components/PersonAvatar.svelte';
  import ClientLogo from '$lib/components/ClientLogo.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import StatusIcon from '$lib/components/StatusIcon.svelte';
  import type { TaskWithNotes } from '$lib/types';

  const STRIKE_MS = 700;

  let task = $state<TaskWithNotes | null>(null);
  let missing = $state(false);
  let next = $state<string | null>(null);
  let striking = $state(false);
  let journal = $state<HTMLElement | null>(null);

  const id = $derived(page.params.id ?? '');
  const repo = $derived(task ? taskRepo(task, $config) : null);
  const who = $derived(task?.requester ? personFor(task.requester, $config) : undefined);
  const client = $derived(task?.client ? clientFor(task.client, $config) : undefined);
  const finished = $derived(task?.status === 'done');

  async function load() {
    if (!id) return;
    try {
      const fresh = await api.get(id);
      const prev = task;
      task = fresh;
      missing = false;
      await advance(prev?.steps ?? null, fresh.steps);
      if (!prev || fresh.notes.length !== prev.notes.length) scrollJournal(!prev);
    } catch {
      missing = true;
    }
  }

  async function advance(before: string[] | null, after: string[]) {
    const head = after[0] ?? null;
    if (before === null || next === null) { next = head; return; }
    if (next === head) return;
    if (!after.includes(next)) {
      striking = true;
      await new Promise((r) => setTimeout(r, STRIKE_MS));
      striking = false;
    }
    next = task?.steps[0] ?? null;
  }

  async function scrollJournal(instant: boolean) {
    await tick();
    journal?.scrollTo({ top: journal.scrollHeight, behavior: instant ? 'instant' : 'smooth' });
  }

  onMount(() => {
    const off = onWs((msg) => {
      const tid = 'task' in msg ? msg.task.id : 'task_id' in msg ? msg.task_id : 'id' in msg ? msg.id : null;
      if (tid === id) load();
    });
    // Safety net for a dropped socket: the WS reconnect does not replay missed events.
    const poll = setInterval(load, 30_000);
    return () => { off(); clearInterval(poll); };
  });

  $effect(() => { if (id) { task = null; next = null; load(); } });
</script>

<svelte:head><title>{task?.title ?? 'agenda'}</title></svelte:head>

<div class="focus">
  {#if missing}
    <p class="empty">{m.td_not_found({ id })}</p>
  {:else if !task}
    <p class="empty">{m.td_loading()}</p>
  {:else}
    <header>
      <h1>{task.title}</h1>
      <div class="meta">
        <span class="status s-{task.status}"><StatusIcon status={task.status} size={12} />{statusLabel(task.status)}</span>
        {#if hasDue(task)}
          <span class="due" class:over={!finished && isPastDue(task.due_at)}><Icon name="clock" size={12} />{fmtDueNum(task.due_at)}</span>
        {/if}
        <!-- Faces only; the name slides out on hover or focus to save width. -->
        {#if task.requester}
          <span class="chip" tabindex="0" role="note" aria-label={who?.label ?? task.requester}>
            <PersonAvatar photo={who?.photo} size={18} alt={who?.label ?? task.requester} /><span class="name">{who?.label ?? task.requester}</span>
          </span>
        {/if}
        {#if task.client}
          <span class="chip" tabindex="0" role="note" aria-label={client?.label ?? task.client}>
            <ClientLogo logo={client?.logo} size={18} alt={client?.label ?? task.client} /><span class="name">{client?.label ?? task.client}</span>
          </span>
        {/if}
      </div>
      {#if task.blocked_by?.length}
        <div class="blocked"><Icon name="lock" size={12} />{m.td_blocked_by()}: {task.blocked_by.map((d) => d.title).join(', ')}</div>
      {/if}
      {#if task.summary}
        <div class="summary md">{@html renderMarkdown(task.summary, repo, $config)}</div>
      {/if}
    </header>

    <ol class="journal" bind:this={journal}>
      {#each task.notes as n (n.id)}
        <!-- A note that opens with a list item is one list, not headline + rest. -->
        {@const split = /^\s*([-*+]|\d+\.)\s/.test(n.body) ? { headline: '', rest: n.body } : splitNote(n.body)}
        <li in:fly={{ y: 16, duration: 400 }}>
          <div class="mark">
            <span class="dot"><Icon name="check" size={10} /></span>
            <time datetime={n.created_at}>{fmtDayNum(n.created_at)}</time>
          </div>
          <div class="body">
            {#if split.headline}<div class="md head">{@html renderMarkdown(split.headline, repo, $config)}</div>{/if}
            <div class="md">{@html renderMarkdown(split.rest, repo, $config)}</div>
          </div>
        </li>
      {/each}
    </ol>

    <footer>
      {#if next}
        {#key next}
          <div class="next" class:striking in:fly={{ x: 60, duration: 350, delay: 150 }} out:fly={{ x: -80, duration: 300 }}>
            <span class="label">{m.focus_next()}</span>
            <div class="md text">{@html renderMarkdown(next, repo, $config)}</div>
            {#if task.steps.length > 1}<span class="more">{m.focus_more({ n: task.steps.length - 1 })}</span>{/if}
          </div>
        {/key}
      {:else if task.closing}
        <div class="closing" in:fade={{ duration: 400 }}>
          <span class="label">{m.td_closing()}</span>
          <div class="md">{@html renderMarkdown(task.closing, repo, $config)}</div>
        </div>
      {:else}
        <p class="empty" in:fade>{finished ? m.focus_finished() : m.td_no_steps()}</p>
      {/if}
    </footer>
  {/if}
</div>

<style>
  .focus {
    display: flex; flex-direction: column; height: 100vh; max-width: 480px; margin: 0 auto;
    padding: 14px 14px 12px; gap: 12px; font-size: 14px;
  }
  .md { overflow-wrap: anywhere; }
  .md :global(> :first-child) { margin-top: 0; }
  .md :global(> :last-child) { margin-bottom: 0; }
  .md :global(p) { margin: 4px 0; }
  .md :global(ul), .md :global(ol) { margin: 4px 0; padding-left: 18px; }
  .md :global(code) { background: var(--bg-glass-hover); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .md :global(pre) { background: var(--bg-glass-hover); padding: 6px 8px; border-radius: 4px; overflow-x: auto; margin: 4px 0; }
  .md :global(pre code) { background: transparent; padding: 0; }
  .md :global(a) { color: var(--link); }
  .md :global(a:hover) { color: var(--link-hover); }
  .empty { color: var(--text-muted); text-align: center; margin: auto 0; }
  header { display: flex; flex-direction: column; gap: 8px; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 12px; color: var(--text-muted); }
  /* Same status palette as the agenda drawer. */
  .status { --st: var(--link); display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px;
    color: var(--st); background: color-mix(in srgb, var(--st) 14%, transparent); border: 1px solid color-mix(in srgb, var(--st) 40%, transparent); }
  .status.s-in_progress { --st: var(--accent); }
  .status.s-snoozed { --st: var(--amber); }
  .status.s-done { --st: var(--green); }
  .status.s-shelved { --st: var(--red); }
  .due { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; }
  .due.over { color: var(--red); }
  .chip {
    display: inline-flex; align-items: center; padding: 2px; border-radius: 999px; outline: none;
    background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-secondary);
  }
  .chip .name {
    max-width: 0; overflow: hidden; white-space: nowrap; opacity: 0;
    transition: max-width 0.25s ease, opacity 0.2s, margin 0.25s;
  }
  .chip:hover .name, .chip:focus-visible .name { max-width: 180px; opacity: 1; margin: 0 6px 0 5px; }
  h1 { font-size: 19px; line-height: 1.25; font-weight: 650; }
  .summary { color: var(--text-secondary); font-size: 13px; max-height: 35vh; overflow-y: auto; }

  .journal {
    flex: 1; min-height: 0; overflow-y: auto; list-style: none; display: flex; flex-direction: column;
    gap: 10px; padding: 4px 2px; border-top: 1px solid var(--border-glass);
    mask-image: linear-gradient(to bottom, transparent, #000 24px);
  }
  .journal li { display: flex; gap: 6px; }
  .journal li:first-child { margin-top: auto; padding-top: 18px; }
  .dot {
    flex: none; width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
    background: var(--green-dim); color: var(--green); border: 1px solid var(--green-border); margin-top: 1px;
  }
  .body { min-width: 0; }
  .body .md { color: var(--text-secondary); font-size: 13px; overflow-wrap: anywhere; }
  .body .md.head { color: var(--text-primary); font-weight: 600; }
  .journal li:last-child .body .md { color: var(--text-primary); }
  .mark { flex: 0 0 34px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
  time { font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }

  footer { display: grid; }
  footer > * { grid-area: 1 / 1; }
  .next, .closing {
    padding: 12px 14px; border-radius: 12px; background: var(--bg-glass);
    border: 1px solid var(--accent-border); display: flex; flex-direction: column; gap: 4px;
  }
  .closing { border-color: var(--green-border); }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); }
  .closing .label { color: var(--green); }
  .text { font-size: 15px; overflow-wrap: anywhere; }
  .more { font-size: 11px; color: var(--text-muted); }
  .blocked { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--amber); }
  /* Strike-through fades in before the card slides away (works across wrapped lines). */
  .text { text-decoration: line-through 1.5px transparent; transition: text-decoration-color 0.5s, color 0.5s; }
  .striking { border-color: var(--green-border); }
  .striking .text { text-decoration-color: var(--green); color: var(--text-muted); }
</style>
