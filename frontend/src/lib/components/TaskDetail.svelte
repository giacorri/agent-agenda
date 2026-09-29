<script lang="ts">
  import { tick } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { selectedTaskId, tasks, linkPick } from '$lib/stores/tasks';
  import { matcher, requestSearchFocus } from '$lib/stores/search';
  import { showNotice } from '$lib/stores/view';
  import { api, ApiError } from '$lib/api';
  import { onWs } from '$lib/ws';
  import { renderMarkdown, splitNote } from '$lib/markdown';
  import { tagIcon } from '$lib/services';
  import { config, categories, categoryMeta, people, personFor, clients, clientFor, taskRepo, requesterMatches, clientMatches } from '$lib/stores/config';
  import { isHidden, hiddenScope, defaultScope } from '$lib/stores/scope';
  import { relativeTime, hasDue, startOfDay } from '$lib/time';
  import { getLocale } from '$lib/i18n';
  import { fmtFull as fmtFullDate, fmtDateTime, fmtDayTimeNum, statusLabel } from '$lib/format';
  import * as m from '$lib/paraglide/messages';
  import Icon from './Icon.svelte';
  import ScopeIcon from './ScopeIcon.svelte';
  import PersonAvatar from './PersonAvatar.svelte';
  import ClientLogo from './ClientLogo.svelte';
  import TaskCard from './TaskCard.svelte';
  import type { Task, TaskWithNotes, Note } from '$lib/types';

  let task = $state<TaskWithNotes | null>(null);
  // Default repo for bare refs (#98, PR#98) in this task's text, from its tags/services.
  const repo = $derived(task ? taskRepo(task) : null);
  // Countdown chip beside the deadline. Days are counted on calendar days in local
  // time, so "tomorrow at 09:00" reads as 1 day even if it is 15 hours away; passing
  // the exact hour is what turns it red.
  const dueIn = $derived.by(() => {
    if (!task || !hasDue(task)) return null;
    const due = new Date(task.due_at);
    const now = new Date();
    if (due.getTime() < now.getTime()) return { tone: 'late', label: m.overdue() };
    const days = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / 86400000);
    const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto', style: 'long' });
    return { tone: days > 3 ? 'ok' : 'soon', label: rtf.format(days, 'day') };
  });

  let loading = $state(false);
  let noteBody = $state('');
  let error = $state('');

  // Next-steps inline editor (one step per line) — lives in its own column,
  // independent of the issue edit mode below.
  let editingSteps = $state(false);
  let stepsDraft = $state('');

  // Single "edit task" mode: one pencil flips every user-owned field (title,
  // summary, services/tags, due, requester, closing, work/personal) into a form at
  // once, saved with one batched PATCH. Provenance (source, cwd, created_at) stays
  // read-only; status stays always-live (it patches instantly).
  let editingIssue = $state(false);
  let titleDraft = $state('');
  let summaryDraft = $state('');
  let dueDraft = $state('');
  let svcDraft = $state('');
  let tagsDraft = $state('');
  let reqDraft = $state('');
  let clientDraft = $state('');
  let closingDraft = $state('');
  let personalDraft = $state(false);  // work/personal is only switchable in edit mode
  // Configured people drive the closing-message register (see the handoff-recap skill).
  const knownRequesters = $derived($people.map((p) => p.key));

  // A requester is "known" only if some roster person's key matches it — the same
  // substring rule the sidebar counts by. An unknown requester never shows in the
  // sidebar, so we offer a one-click "add to roster" shortcut next to it.
  const knownRequester = (name: string | null | undefined) =>
    !!name?.trim() && $people.some((p) => requesterMatches(name, p.key));
  async function addRequester(name: string) {
    const key = name.trim();
    if (!key) return;
    try { await api.savePerson({ key, label: key, role: '', sort: $people.length }); }
    catch (err) { error = String(err); }
  }

  // Same roster logic for clients: an unconfigured one never reaches the sidebar,
  // so offer the one-click promotion next to it.
  const knownClientNames = $derived($clients.map((c) => c.key));
  const knownClient = (name: string | null | undefined) =>
    !!name?.trim() && $clients.some((c) => clientMatches(name, c.key));
  async function addClient(name: string) {
    const key = name.trim();
    if (!key) return;
    try { await api.saveClient({ key, label: key, sort: $clients.length }); }
    catch (err) { error = String(err); }
  }

  // The work/personal "tipo" toggle reflects the configured scopes: it shows only
  // when a hidden (personal-like) scope exists, and toggles that scope's tag.
  const hScope = $derived(hiddenScope($config));
  const defScope = $derived(defaultScope($config));

  // Per-note body editor + the per-note ⋯ actions menu (edit / delete).
  let editingNoteId = $state<string | null>(null);
  let noteEditDraft = $state('');
  let menuNoteId = $state<string | null>(null);

  // Custom status picker (button + popover) replacing the bare <select>.
  let statusMenu = $state(false);
  const STATUSES = ['pending', 'in_progress', 'snoozed', 'done', 'shelved'] as const;
  const STATUS_ICON: Record<string, string> = {
    pending: 'dot', in_progress: 'play', snoozed: 'clock', done: 'check', shelved: 'package',
  };
  // Suggestions for the services field come from the configured categories.
  const knownServices = $derived($categories.map((c) => c.key));

  // Open tasks (not this one, not already a prerequisite) eligible to become a prerequisite.
  // Resolve a DepRef to the full task in the feed so the chain renders real cards.
  const resolve = (ref: { id: string }) => $tasks.find((t) => t.id === ref.id);

  const candidates = $derived(
    $tasks.filter((t) =>
      t.id !== task?.id && t.status !== 'done' && t.status !== 'shelved' &&
      !(task?.blocked_by ?? []).some((b) => b.id === t.id)
    )
  );

  // Prerequisite picker: a search box over the candidates (same index and AND-of-words
  // rule as the global search) with a keyboard-navigable dropdown. Empty query → the
  // first few candidates, so the list is browsable without typing.
  const DEP_MAX = 8;
  let depQuery = $state('');
  let depOpen = $state(false);
  let depCursor = $state(0);
  let depInput = $state<HTMLInputElement | undefined>();
  const depMatches = $derived(candidates.filter(matcher(depQuery, $config)).slice(0, DEP_MAX));
  $effect(() => { depQuery; depCursor = 0; });  // retyping resets the highlight
  // The list flows under the input (the column scrolls, an absolute popover would be
  // clipped at its bottom), so bring it on screen when it opens.
  $effect(() => { if (depOpen) tick().then(() => depList?.scrollIntoView({ block: 'nearest' })); });
  let depList = $state<HTMLUListElement | undefined>();

  async function addDep(depId: string) {
    if (!task) return;
    depOpen = false; depQuery = '';
    try {
      const updated = await api.addDep(task.id, depId);
      task = { ...task, blocked_by: updated.blocked_by };
    } catch (err) { error = String(err); }
  }
  function onDepKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (!depOpen && !depQuery) return;  // nothing to dismiss: let the drawer handle it
      e.stopPropagation(); depOpen = false; depQuery = ''; depInput?.blur(); return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); depOpen = true; depCursor = Math.min(depCursor + 1, depMatches.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); depCursor = Math.max(depCursor - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = depMatches[depCursor]; if (c) addDep(c.id); }
  }
  // Leave the drawer and pick the prerequisite among the real cards, with the global
  // search at hand: TaskCard links the clicked one and reopens this task.
  function pickFromAgenda() {
    if (!task) return;
    linkPick.set({ childId: task.id, title: task.title });
    selectedTaskId.set(null);
    requestSearchFocus();
  }

  async function onRemoveDep(depId: string) {
    if (!task) return;
    task = { ...task, blocked_by: (task.blocked_by ?? []).filter((b) => b.id !== depId) };
    try { await api.removeDep(task.id, depId); }
    catch (err) { error = String(err); }
  }

  $effect(() => {
    const id = $selectedTaskId;
    if (!id) { task = null; return; }
    if ($linkPick) linkPick.set(null);  // the drawer is back: pick mode is over either way
    loading = true; error = '';
    editingSteps = false; editingIssue = false;
    editingNoteId = null; menuNoteId = null;
    api.get(id).then(t => { task = t; loading = false; })
      .catch(e => {
        loading = false;
        // A dead link (deleted task, mistyped id) drops back to the agenda with a
        // one-line notice instead of an error drawer over an empty page.
        if (e instanceof ApiError && e.status === 404) { showNotice(m.td_not_found({ id })); selectedTaskId.set(null); return; }
        error = String(e);
      });
  });

  // The address bar mirrors the drawer: /task/<id> while it is open, the URL it was
  // on once it closes — so copying the bar always yields a valid deep link. Shallow
  // replaceState leaves history alone (no extra entries, back button unchanged).
  // Only a /task/ URL is ever rewritten, so a real navigation while the drawer is
  // open (which changes the path underneath it) is never undone on close.
  const taskPath = (id: string) => `/task/${id}`;
  let returnUrl: string | null = null;
  let lastId: string | null = null;
  $effect(() => {
    const id = $selectedTaskId;
    const prev = lastId;
    lastId = id;
    if (id) {
      if (location.pathname === taskPath(id)) return;  // deep link: already there
      if (!location.pathname.startsWith('/task/')) returnUrl = location.pathname + location.search + location.hash;
      setUrl(taskPath(id));
    } else if (prev && location.pathname.startsWith('/task/')) {
      setUrl(returnUrl ?? '/');
      returnUrl = null;
    }
  });
  function setUrl(url: string) {
    try { replaceState(url, {}); }
    catch { history.replaceState(history.state, '', url); }  // router not up yet (first paint)
  }

  onWs((m) => {
    if (!task) return;
    if (m.type === 'note.added' && m.task_id === task.id) {
      if (!task.notes.some(n => n.id === m.note.id)) task = { ...task, notes: [...task.notes, m.note] };
    } else if (m.type === 'note.updated' && m.task_id === task.id) {
      task = { ...task, notes: task.notes.map(n => n.id === m.note.id ? m.note : n) };
    } else if (m.type === 'note.deleted' && m.task_id === task.id) {
      task = { ...task, notes: task.notes.filter(n => n.id !== m.note_id) };
    } else if (m.type === 'task.updated' && m.task.id === task.id) {
      task = { ...task, ...m.task };
    } else if (m.type === 'task.deleted' && m.id === task.id) {
      selectedTaskId.set(null);
    }
  });

  function close() { selectedTaskId.set(null); }

  async function addNote(e: Event) {
    e.preventDefault();
    if (!task || !noteBody.trim()) return;
    try { await api.addNote(task.id, { body: noteBody.trim() }); noteBody = ''; }
    catch (err) { error = String(err); }
  }

  async function removeNote(noteId: string) {
    if (!task) return;
    menuNoteId = null;
    const keep = task.notes.filter(n => n.id !== noteId);
    task = { ...task, notes: keep };
    try { await api.deleteNote(task.id, noteId); }
    catch (err) { error = String(err); }
  }

  function startEditSteps() {
    if (!task) return;
    stepsDraft = task.steps.join('\n');
    editingSteps = true;
  }
  async function saveSteps() {
    if (!task) return;
    const steps = stepsDraft.split('\n').map(s => s.trim()).filter(Boolean);
    task = { ...task, steps };
    editingSteps = false;
    try { await api.setSteps(task.id, steps); }
    catch (err) { error = String(err); }
  }

  // Title → clipboard, with a short check-mark confirmation on the button itself.
  let titleCopied = $state(false);
  let titleCopiedTimer: ReturnType<typeof setTimeout> | null = null;
  async function copyTitle() {
    if (!task) return;
    try {
      await navigator.clipboard.writeText(task.title);
      titleCopied = true;
      if (titleCopiedTimer) clearTimeout(titleCopiedTimer);
      titleCopiedTimer = setTimeout(() => { titleCopied = false; }, 1400);
    } catch (err) { error = String(err); }
  }

  // Deep link → clipboard; the host comes from the page itself, never hardcoded.
  let linkCopied = $state(false);
  let linkCopiedTimer: ReturnType<typeof setTimeout> | null = null;
  async function copyLink() {
    if (!task) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}${taskPath(task.id)}`);
      linkCopied = true;
      if (linkCopiedTimer) clearTimeout(linkCopiedTimer);
      linkCopiedTimer = setTimeout(() => { linkCopied = false; }, 1400);
    } catch (err) { error = String(err); }
  }

  let cwdCopied = $state(false);
  let cwdCopiedTimer: ReturnType<typeof setTimeout> | null = null;
  async function copyCwd() {
    if (!task?.agent_cwd) return;
    try {
      await navigator.clipboard.writeText(task.agent_cwd);
      cwdCopied = true;
      if (cwdCopiedTimer) clearTimeout(cwdCopiedTimer);
      cwdCopiedTimer = setTimeout(() => { cwdCopied = false; }, 1400);
    } catch (err) { error = String(err); }
  }

  let idCopied = $state(false);
  let idCopiedTimer: ReturnType<typeof setTimeout> | null = null;
  async function copyId() {
    if (!task) return;
    try {
      await navigator.clipboard.writeText(task.id);
      idCopied = true;
      if (idCopiedTimer) clearTimeout(idCopiedTimer);
      idCopiedTimer = setTimeout(() => { idCopied = false; }, 1400);
    } catch (err) { error = String(err); }
  }

  async function copyClosing() {
    if (!task?.closing) return;
    try { await navigator.clipboard.writeText(task.closing); }
    catch (err) { error = String(err); }
  }

  // Generic patch helper: optimistic local update + server PATCH.
  async function patchTask(patch: Partial<Task>) {
    if (!task) return;
    task = { ...task, ...patch };
    try { await api.patch(task.id, patch); }
    catch (err) { error = String(err); }
  }

  // Enter the single edit mode: snapshot every editable field into its draft.
  function startEditIssue() {
    if (!task) return;
    titleDraft = task.title;
    summaryDraft = task.summary ?? '';
    dueDraft = hasDue(task) ? toLocalInput(task.due_at) : '';
    svcDraft = task.services.join(' ');
    // The hidden-scope tag is owned by the work/personal switch, not this free-text field.
    const ht = hiddenScope($config)?.tag?.toLowerCase();
    tagsDraft = task.tags.filter(t => !ht || t.toLowerCase() !== ht).join(' ');
    reqDraft = task.requester ?? '';
    clientDraft = task.client ?? '';
    closingDraft = task.closing ?? '';
    personalDraft = isHidden(task, $config);
    editingIssue = true;
  }
  function cancelEditIssue() { editingIssue = false; }

  // Save the whole issue in one batched PATCH.
  async function saveIssue() {
    if (!task) return;
    const patch: Partial<Task> = {};

    const title = titleDraft.trim();
    if (title && title !== task.title) patch.title = title;

    patch.summary = summaryDraft.trim() || null;

    const ht = hiddenScope($config)?.tag;
    const htLower = ht?.toLowerCase();
    patch.services = svcDraft.toLowerCase().split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    const tags = tagsDraft.split(/[\s,]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean)
      .filter(t => !htLower || t.toLowerCase() !== htLower);
    if (ht && personalDraft) tags.push(ht);  // apply the work/personal choice from edit mode
    patch.tags = tags;

    if (dueDraft) {
      const iso = new Date(dueDraft).toISOString();
      patch.due_at = iso;
      patch.remind_at = iso;  // keep remind_at aligned with due (matches snooze behaviour)
    } else {
      patch.due_at = '';      // cleared → general task with no deadline
      patch.remind_at = '';
    }

    patch.requester = reqDraft.trim() || null;
    patch.client = clientDraft.trim() || null;
    patch.closing = closingDraft.trim() || null;

    editingIssue = false;
    await patchTask(patch);
  }

  async function saveStatus(value: string) {
    if (!task || value === task.status) return;
    const patch: Partial<Task> = { status: value as Task['status'] };
    if (value === 'done') patch.completed_at = task.completed_at ?? new Date().toISOString();
    else patch.completed_at = null;
    await patchTask(patch);
  }

  function startEditNote(n: Note) { menuNoteId = null; editingNoteId = n.id; noteEditDraft = n.body; }
  async function saveNote(noteId: string) {
    if (!task) return;
    const body = noteEditDraft.trim();
    editingNoteId = null;
    if (!body) return;
    task = { ...task, notes: task.notes.map(n => n.id === noteId ? { ...n, body } : n) };
    try { await api.editNote(task.id, noteId, body); }
    catch (err) { error = String(err); }
  }

  // Deadline quick-edit: clicking the date opens the browser's native
  // calendar picker (no need to enter full edit mode); change saves instantly.
  let dueInput = $state<HTMLInputElement | undefined>();
  function openDuePicker() {
    if (!task || !dueInput) return;
    dueInput.value = hasDue(task) ? toLocalInput(task.due_at) : toLocalInput(new Date().toISOString());
    try { dueInput.showPicker(); } catch { dueInput.focus(); }
  }
  async function saveDue(value: string) {
    if (!task || !value) return;
    const iso = new Date(value).toISOString();
    await patchTask({ due_at: iso, remind_at: iso });  // remind_at follows due, like saveIssue
  }

  function toLocalInput(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const fmtFull = (iso: string) => fmtFullDate(iso);
  const fmtNoteTime = (iso: string) => fmtDateTime(iso);
  function noteLabel(k: Note['kind']) {
    return k === 'file' ? m.note_file() : k === 'link' ? m.note_link() : m.note_text();
  }
</script>

<!-- Esc steps back one layer at a time: open note menu → issue edit → drawer.
     Inline edit inputs stopPropagation, so their own Esc cancels the edit directly. -->
<svelte:window onkeydown={(e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || !$selectedTaskId) return;
  if (menuNoteId) { menuNoteId = null; return; }
  if (editingIssue) { cancelEditIssue(); return; }
  close();
}} />

{#if $selectedTaskId}
  <div class="overlay" onclick={close} role="presentation"></div>
  <aside class="panel glass">
    {#if loading}
      <div class="state">{m.td_loading()}</div>
    {:else if error}
      <div class="state err">{error}</div>
    {:else if task}
      {#if menuNoteId}
        <div class="menu-backdrop" role="presentation" onclick={() => menuNoteId = null}></div>
      {/if}
      <header>
        <div class="meta">
          <span class="src">{task.source === 'agent' ? m.td_source_agent() : m.td_source_me()}</span>
          {#if hScope}
            {@const personal = isHidden(task, $config)}
            {@const curScope = personal ? hScope : defScope}
            <div class="req-row">
              {#if editingIssue}
                <!-- Scope is only switchable while editing; both options shown with their glyphs. -->
                <button type="button" role="switch" aria-checked={personalDraft}
                  class="switch" class:on={personalDraft} onclick={() => personalDraft = !personalDraft}>
                  <span class="sw-label off"><ScopeIcon icon={defScope?.icon} size={16} /> {defScope?.label ?? m.td_work_fallback()}</span>
                  <span class="sw-track"><span class="sw-knob"></span></span>
                  <span class="sw-label on"><ScopeIcon icon={hScope.icon} size={16} /> {hScope.label}</span>
                </button>
              {:else}
                <!-- Read-only: just which scope the task is in. -->
                <span class="scope-now" class:personal>
                  <ScopeIcon icon={curScope?.icon} size={16} /> {curScope?.label ?? (personal ? hScope.label : m.td_work_fallback())}
                </span>
              {/if}
            </div>
          {/if}
          <span class="when"><b>{m.td_created()}</b>: {fmtFull(task.created_at)}</span>
          <span class="task-id"><code title={task.id}>{task.id}</code>
            <button type="button" class="copy-mini" class:ok={idCopied} onclick={copyId}
              aria-label={m.td_copy_id()} title={idCopied ? m.copy_done() : m.td_copy_id()}><Icon name={idCopied ? 'check' : 'copy'} size={13} /></button>
          </span>
        </div>
        <div class="head-actions">
          <button class="copy-link" class:ok={linkCopied} onclick={copyLink}
            aria-label={m.td_copy_link()} title={linkCopied ? m.copy_done() : m.td_copy_link()}><Icon name={linkCopied ? 'check' : 'link'} size={17} /></button>
          <button class="close" onclick={close} aria-label={m.td_close()}><Icon name="close" size={18} /></button>
        </div>
      </header>

      <!-- Title and the identity facts share the top band: the facts sit to the
           right of the title instead of opening the left column. -->
      <div class="head-main" class:editing={editingIssue}>
        <div class="head-title">
        {#if editingIssue}
          <div class="title-edit">
            <input class="title-input" bind:value={titleDraft}
              onkeydown={(e) => { if (e.key === 'Enter') saveIssue(); if (e.key === 'Escape') { cancelEditIssue(); e.stopPropagation(); } }} />
            <button class="req-btn" onclick={saveIssue}>{m.common_save()}</button>
            <button class="req-btn ghost" onclick={cancelEditIssue}>{m.common_cancel()}</button>
          </div>
        {:else}
          <h2 class="editable">{task.title}<button class="copy-btn" class:ok={titleCopied} onclick={copyTitle} aria-label={m.copy_title()} title={titleCopied ? m.copy_done() : m.copy_title()}><Icon name={titleCopied ? 'check' : 'copy'} size={14} /> {titleCopied ? m.copy_done() : m.td_copy()}</button><button class="edit-btn" onclick={startEditIssue} aria-label={m.td_edit_issue()} title={m.td_edit_issue()}><Icon name="pencil" size={14} /> {m.td_edit()}</button></h2>
        {/if}
          <!-- The deadline is the one date worth acting on, so it sits right under the
               title; "created" stays up in the top line next to the source. -->
          <div class="head-dates">
            <!-- Status first: it is the fact read before the date, so it gets the
                 tinted pill and sits left of the deadline. -->
            <div class="req-row">
              <b>{m.td_status()}</b>:
              <div class="status-wrap">
                <button type="button" class="status-btn st-{task.status}" onclick={() => statusMenu = !statusMenu}
                  aria-haspopup="menu" aria-expanded={statusMenu}>
                  <span class="st-ico"><Icon name={STATUS_ICON[task.status] ?? 'dot'} size={14} /></span>
                  <span>{statusLabel(task.status)}</span>
                  <Icon name="chevron" size={13} />
                </button>
                {#if statusMenu}
                  <div class="status-backdrop" role="presentation" onclick={() => statusMenu = false}></div>
                  <div class="status-menu" role="menu">
                    {#each STATUSES as val}
                      <button type="button" role="menuitemradio" aria-checked={task.status === val}
                        class="status-opt" class:sel={task.status === val}
                        onclick={() => { saveStatus(val); statusMenu = false; }}>
                        <span class="st-ico st-{val}"><Icon name={STATUS_ICON[val]} size={14} /></span>
                        {statusLabel(val)}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
            <div class="req-row">
              <b>{m.td_deadline()}</b>:
              {#if editingIssue}
                <input class="req-edit" type="datetime-local" bind:value={dueDraft}
                  onkeydown={(e) => { if (e.key === 'Enter') saveIssue(); if (e.key === 'Escape') { cancelEditIssue(); e.stopPropagation(); } }} />
                {#if dueDraft}
                  <button type="button" class="req-btn ghost" onclick={() => (dueDraft = '')} title={m.td_clear_deadline()}>{m.td_clear_deadline()}</button>
                {/if}
              {:else}
                <span class="due-wrap">
                  <button type="button" class="due-btn" onclick={openDuePicker} title={m.td_change_deadline()}>
                    <Icon name="calendar" size={13} /> {hasDue(task) ? fmtFull(task.due_at) : m.no_deadline()}
                  </button>
                  <input class="due-native" type="datetime-local" bind:this={dueInput} tabindex="-1"
                    onchange={(e) => saveDue(e.currentTarget.value)} />
                </span>
                {#if dueIn}<span class="due-in {dueIn.tone}">{dueIn.label}</span>{/if}
              {/if}
            </div>
          </div>
        </div>
        <div class="cwd">
          <!-- Requester and client show only when set: an empty one is noise in a
               strip meant to be read at a glance. -->
          {#if editingIssue || task.requester}
          <div class="req-row">
            <b>{m.td_requested_by()}</b>:
            {#if editingIssue}
              <input class="req-edit" list="known-requesters" bind:value={reqDraft} placeholder={m.td_requester_placeholder()}
                onkeydown={(e) => { if (e.key === 'Enter') saveIssue(); if (e.key === 'Escape') { cancelEditIssue(); e.stopPropagation(); } }} />
              <datalist id="known-requesters">
                {#each knownRequesters as r}<option value={r}></option>{/each}
              </datalist>
              {#if reqDraft.trim() && !knownRequester(reqDraft)}
                <button type="button" class="req-btn" onclick={() => addRequester(reqDraft)}>{m.td_add_requester({ name: reqDraft.trim() })}</button>
              {/if}
            {:else if task.requester}
              {@const who = personFor(task.requester, $config)}
              <span class="req-val"><PersonAvatar photo={who?.photo} size={26} alt={who?.label ?? task.requester} />{who?.label ?? task.requester}</span>
              {#if !knownRequester(task.requester)}
                <button type="button" class="link-btn add-req" onclick={() => addRequester(task?.requester ?? '')}>{m.td_add_requester({ name: task.requester })}</button>
              {/if}
            {/if}
          </div>
          {/if}
          <!-- Client is a work-only notion: a personal task has no company behind it. -->
          {#if !isHidden(task, $config) && (editingIssue || task.client)}
            <div class="req-row">
              <b>{m.td_client()}</b>:
              {#if editingIssue}
                <input class="req-edit" list="known-clients" bind:value={clientDraft} placeholder={m.td_client_placeholder()}
                  onkeydown={(e) => { if (e.key === 'Enter') saveIssue(); if (e.key === 'Escape') { cancelEditIssue(); e.stopPropagation(); } }} />
                <datalist id="known-clients">
                  {#each knownClientNames as c}<option value={c}></option>{/each}
                </datalist>
                {#if clientDraft.trim() && !knownClient(clientDraft)}
                  <button type="button" class="req-btn" onclick={() => addClient(clientDraft)}>{m.td_add_client({ name: clientDraft.trim() })}</button>
                {/if}
              {:else if task.client}
                {@const cl = clientFor(task.client, $config)}
                <a class="req-val client-val" href={`/client/${encodeURIComponent(cl?.key ?? task.client)}`}>
                  <ClientLogo logo={cl?.logo} size={26} alt={cl?.label ?? task.client} />{cl?.label ?? task.client}
                </a>
                {#if !knownClient(task.client)}
                  <button type="button" class="link-btn add-req" onclick={() => addClient(task?.client ?? '')}>{m.td_add_client({ name: task.client })}</button>
                {/if}
              {/if}
            </div>
          {/if}
          {#if task.agent_cwd}
            <div class="cwd-path"><b>cwd</b>: <code title={task.agent_cwd}>{task.agent_cwd}</code>
              <button type="button" class="copy-mini" class:ok={cwdCopied} onclick={copyCwd}
                aria-label={m.td_copy_cwd()} title={cwdCopied ? m.copy_done() : m.td_copy_cwd()}><Icon name={cwdCopied ? 'check' : 'copy'} size={13} /></button>
            </div>
          {/if}
        </div>
      </div>

      <div class="layout">
        <div class="col-left">

      <div class="field">
        <h3>{m.td_description()}</h3>
        {#if editingIssue}
          <textarea class="field-edit" bind:value={summaryDraft} rows="3" placeholder={m.td_desc_placeholder()}></textarea>
        {:else if task.summary}
          <div class="summary md">{@html renderMarkdown(task.summary, repo, $config)}</div>
        {:else}
          <p class="empty">{m.td_no_description()}</p>
        {/if}
      </div>

      <div class="field">
        <h3>{m.td_services_tags()}</h3>
        {#if editingIssue}
          <label class="chip-label">{m.sidebar_services()} <input class="field-input" list="known-services" bind:value={svcDraft} placeholder={m.td_services_placeholder()} /></label>
          <datalist id="known-services">{#each knownServices as s}<option value={s}></option>{/each}</datalist>
          <label class="chip-label">{m.sidebar_tags()} <input class="field-input" bind:value={tagsDraft} placeholder={m.td_tags_placeholder()} /></label>
        {:else if task.services.some((s) => s && s.trim()) || task.tags.some((t) => t && t.trim() && t !== 'personal')}
          <div class="chips">
            {#each task.services.filter((s) => s && s.trim()) as s}
              {@const meta = categoryMeta(s, $config)}
              <a class="chip svc" href={`/service/${encodeURIComponent(s)}`} style={`--svc:${meta.color}`} title={meta.label}>
                <Icon name={meta.icon} size={13} /><span class="lbl">{meta.label}</span>
              </a>
            {/each}
            {#each task.tags.filter((t) => t && t.trim() && t !== 'personal') as t}
              <a class="chip tag" href={`/tag/${encodeURIComponent(t)}`}><Icon name={tagIcon(t)} size={12} />#{t}</a>
            {/each}
          </div>
        {:else}
          <p class="empty">{m.td_no_services_tags()}</p>
        {/if}
      </div>

      <div class="deps">
        <!-- The agenda shortcut lives in the heading, above the picker: anything
             below the search box moves when its list closes on blur, and a button
             that moves between mousedown and mouseup never receives the click. -->
        <h3 class="deps-head"><span><Icon name="lock" size={12} /> {m.td_blocked_by()}</span>
          {#if candidates.length}
            <button type="button" class="link-btn dep-agenda" onclick={pickFromAgenda}>
              <Icon name="grid" size={12} /> {m.td_dep_pick_agenda()}
            </button>
          {/if}
        </h3>
        {#if (task.blocked_by ?? []).length}
          <ul class="dep-chain">
            {#each task.blocked_by ?? [] as b (b.id)}
              {@const full = resolve(b)}
              <li class="dep-node">
                {#if full}
                  <div class="dep-card"><TaskCard task={full} compact /></div>
                {:else}
                  <button class="dep-open" onclick={() => selectedTaskId.set(b.id)}>{b.title}</button>
                {/if}
                <button class="dep-rm" onclick={() => onRemoveDep(b.id)} aria-label={m.td_dep_remove()} title={m.td_dep_remove()}><Icon name="close" size={13} /></button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">{m.td_no_blockers()}</p>
        {/if}
        {#if candidates.length}
          <!-- Combobox: mousedown on the list is swallowed so the input keeps focus
               (and the list stays open) while an option is being clicked. -->
          <div class="dep-search" class:open={depOpen}
            onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) depOpen = false; }}>
            <Icon name="search" size={13} />
            <input bind:this={depInput} bind:value={depQuery} placeholder={m.td_add_blocker()}
              role="combobox" aria-controls="dep-list" aria-expanded={depOpen} aria-haspopup="listbox"
              onfocus={() => depOpen = true} onkeydown={onDepKey} autocomplete="off" spellcheck="false" />
            {#if depOpen}
              <ul id="dep-list" class="dep-list" role="listbox" bind:this={depList} onmousedown={(e) => e.preventDefault()}>
                {#each depMatches as c, i (c.id)}
                  <li>
                    <button type="button" role="option" aria-selected={i === depCursor} class:cur={i === depCursor}
                      onmouseenter={() => depCursor = i} onclick={() => addDep(c.id)}>
                      <span class="st-ico st-{c.status}"><Icon name={STATUS_ICON[c.status] ?? 'dot'} size={12} /></span>
                      <span class="dep-title">{c.title}</span>
                      {#if hasDue(c)}<span class="dep-due">{fmtDayTimeNum(c.due_at)}</span>{/if}
                    </button>
                  </li>
                {:else}
                  <li class="dep-none">{m.td_dep_none({ q: depQuery })}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}

        {#if (task.blocks ?? []).length}
          <h3>{m.td_blocks()}</h3>
          <ul class="dep-chain">
            {#each task.blocks ?? [] as b (b.id)}
              {@const full = resolve(b)}
              <li class="dep-node">
                {#if full}
                  <div class="dep-card"><TaskCard task={full} compact /></div>
                {:else}
                  <button class="dep-open" onclick={() => selectedTaskId.set(b.id)}>{b.title}</button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
        </div>

        <section class="col-notes">
          <h3>{m.td_journal({ count: task.notes.length })}</h3>
          <div class="notes" class:timeline={task.notes.length > 0}>
            {#each task.notes as n (n.id)}
              <article class="note">
                <header>
                  <span class="nh"><Icon name={n.kind === 'file' ? 'file' : n.kind === 'link' ? 'link' : 'note'} size={12} /> {noteLabel(n.kind)} · {fmtNoteTime(n.created_at)}</span>
                  <span class="hdr-right">
                    <span class="rel">{relativeTime(n.created_at)}</span>
                    {#if editingNoteId !== n.id}
                      <div class="note-menu-wrap">
                        <button class="note-act" onclick={() => menuNoteId = menuNoteId === n.id ? null : n.id}
                          aria-label={m.td_note_actions()} title={m.td_note_actions()} aria-haspopup="menu" aria-expanded={menuNoteId === n.id}>
                          <Icon name="more" size={15} />
                        </button>
                        {#if menuNoteId === n.id}
                          <div class="note-menu" role="menu">
                            <button role="menuitem" onclick={() => startEditNote(n)}><Icon name="pencil" size={13} /> {m.td_edit_note()}</button>
                            <button role="menuitem" class="danger" onclick={() => removeNote(n.id)}><Icon name="trash" size={13} /> {m.td_delete_note()}</button>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </span>
                </header>
                {#if editingNoteId === n.id}
                  <textarea class="field-edit" bind:value={noteEditDraft} rows="4"
                    onkeydown={(e) => { if (e.key === 'Escape') { editingNoteId = null; e.stopPropagation(); } }}></textarea>
                  <div class="field-actions">
                    <button class="primary" onclick={() => saveNote(n.id)}>{m.common_save()}</button>
                    <button class="ghost" onclick={() => editingNoteId = null}>{m.common_cancel()}</button>
                  </div>
                {:else if n.kind === 'file'}
                  <a href={`file://${n.body}`} target="_blank" rel="noreferrer">{n.body}</a>
                {:else if n.kind === 'link'}
                  <a href={n.body} target="_blank" rel="noreferrer">{n.body}</a>
                {:else}
                  {@const split = splitNote(n.body)}
                  {#if split.headline}
                    <div class="note-head md">{@html renderMarkdown(split.headline, repo, $config)}</div>
                    <div class="md">{@html renderMarkdown(split.rest, repo, $config)}</div>
                  {:else}
                    <div class="md">{@html renderMarkdown(n.body, repo, $config)}</div>
                  {/if}
                {/if}
              </article>
            {:else}
              <p class="empty">{m.td_no_notes()}</p>
            {/each}
          </div>

          <form class="add-note" onsubmit={addNote}>
            <textarea bind:value={noteBody} placeholder={m.td_add_note_placeholder()} rows="3"></textarea>
            <button type="submit" disabled={!noteBody.trim()}>{m.td_add_note()}</button>
          </form>
        </section>

        <aside class="col-plan">
          <div class="steps-head">
            <h3>{m.td_next_steps()}</h3>
            {#if !editingSteps}
              <button class="link-btn icon-edit" onclick={startEditSteps} aria-label={m.td_edit_steps()} title={m.td_edit_steps()}><Icon name="pencil" size={14} /></button>
            {/if}
          </div>

          {#if editingSteps}
            <textarea class="steps-edit" bind:value={stepsDraft} rows="8" placeholder={m.td_steps_placeholder()}></textarea>
            <div class="steps-actions">
              <button class="primary" onclick={saveSteps}>{m.common_save()}</button>
              <button class="ghost" onclick={() => editingSteps = false}>{m.common_cancel()}</button>
            </div>
            <p class="hint">{m.td_steps_hint()}</p>
          {:else}
            <ol class="steps">
              {#each task.steps as s, i (i)}
                <li class="step-box">
                  <span class="step-num">{i + 1}</span>
                  <div class="md step-text">{@html renderMarkdown(s, repo, $config)}</div>
                </li>
              {:else}
                <p class="empty">{m.td_no_steps()}</p>
              {/each}
            </ol>
          {/if}

          <section class="closing" class:empty-box={!task.closing && !editingIssue}>
            <div class="closing-head">
              <h3><Icon name="check" size={13} /> {#if task.requester}{m.td_closing_for({ who: personFor(task.requester, $config)?.label ?? task.requester })}{:else}{m.td_closing()}{/if}</h3>
              {#if task.closing && !editingIssue}
                <div class="closing-actions">
                  <button class="link-btn" onclick={copyClosing} title={m.td_copy_clipboard()}>{m.td_copy()}</button>
                </div>
              {/if}
            </div>
            {#if editingIssue}
              <textarea class="closing-edit" bind:value={closingDraft} rows="6" placeholder={m.td_closing_placeholder()}></textarea>
            {:else if task.closing}
              <div class="closing-body md">{@html renderMarkdown(task.closing, repo, $config)}</div>
            {:else}
              <p class="empty">{m.td_closing_empty()}</p>
            {/if}
          </section>
        </aside>
      </div>
    {/if}
  </aside>
{/if}

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 50; }
  .panel {
    position: fixed; inset: 0;
    padding: 20px 32px 28px; overflow: hidden;
    display: flex; flex-direction: column; gap: 10px;
    z-index: 51;
    background: linear-gradient(135deg, rgba(26, 16, 53, 0.97), rgba(15, 15, 26, 0.97));
    backdrop-filter: blur(20px);
    border-radius: 0;
    box-sizing: border-box;
  }
  .panel * { min-width: 0; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  /* Top line: where the task comes from, which scope it is in, when it was created —
     the three facts you read once and never act on. */
  .meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; color: var(--text-muted); }
  .meta .src { color: var(--accent); }
  .meta b { font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
  .meta .scope-now { font-size: 12px; }
  .head-actions { display: inline-flex; align-items: center; gap: 12px; }
  .close, .copy-link { display: inline-flex; align-items: center; background: transparent; border: none; color: var(--text-muted); cursor: pointer; line-height: 1; padding: 2px; }
  .close:hover, .copy-link:hover { color: var(--text-primary); }
  .copy-link.ok { color: var(--green); }
  /* Top band: title on the left, identity facts (type/status/deadline/requester/
     client) to its right. The facts read as a wrapping strip divided from the title
     by a hairline — a boxed card there left a hole of empty space under the title.
     The rule underneath belongs to the band, so it runs full width either way. */
  .head-main { display: flex; align-items: center; gap: 0; padding-bottom: 14px; border-bottom: 1px solid var(--border-glass); }
  .head-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .head-dates { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--text-muted); }
  .head-dates b { font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
  .head-dates .req-row + .req-row { padding-left: 14px; border-left: 1px solid var(--border-glass); }
  /* How much runway is left: green with room to spare, amber inside three days,
     red once the hour is past. */
  .due-in { padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid transparent; }
  .due-in.ok { background: var(--green-dim, var(--bg-glass)); border-color: var(--green-border, var(--border-glass)); color: var(--green, var(--text-secondary)); }
  .due-in.soon { background: color-mix(in srgb, var(--amber, #d9a441) 15%, transparent); border-color: color-mix(in srgb, var(--amber, #d9a441) 40%, transparent); color: var(--amber, #d9a441); }
  .due-in.late { background: color-mix(in srgb, var(--red, #d95d5d) 15%, transparent); border-color: color-mix(in srgb, var(--red, #d95d5d) 40%, transparent); color: var(--red, #d95d5d); }
  .head-main .title-edit { flex: 1; min-width: 0; }
  .head-main > .cwd {
    flex: 0 1 auto; max-width: 46%;
    display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
    font-size: 15px; color: var(--text-secondary);
    background: transparent; border-radius: 0; padding: 2px 0 2px 28px;
    margin: 0 clamp(24px, 6vw, 96px) 0 28px;
    border-left: 1px solid var(--border-glass);
  }
  .head-main.editing > .cwd { max-width: 58%; }
  .head-main > .cwd > * { display: inline-flex; align-items: center; gap: 7px; }
  .head-main > .cwd b { font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
  .head-main > .cwd .req-val { font-size: 16px; font-weight: 600; }
  /* The working directory stays the small technical footnote of the block, and the
     one long value: it truncates instead of forcing the strip wider. */
  .head-main > .cwd .cwd-path { font-size: 12px; }
  .head-main > .cwd code { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Tiny copy affordance beside the path, lit only on hover like the header link button. */
  .copy-mini { display: inline-flex; align-items: center; background: transparent; border: none; padding: 2px; border-radius: 4px; color: var(--text-muted); cursor: pointer; line-height: 1; }
  .copy-mini:hover { color: var(--accent); background: var(--bg-glass-hover); }
  .copy-mini.ok { color: var(--green); }
  .task-id { display: inline-flex; align-items: center; gap: 4px; }
  .task-id code { font-size: 12px; color: var(--text-muted); }
  h2 { font-size: clamp(27px, 2.8vw, 40px); font-family: system-ui, -apple-system, sans-serif; font-weight: 700; letter-spacing: -0.015em; color: var(--text-primary); line-height: 1.25; min-width: 0; }
  h2.editable { cursor: pointer; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  /* Single entry point to edit the whole task: faint at rest so it's discoverable
     without cluttering the title, fully lit on hover. */
  h2.editable .edit-btn {
    display: inline-flex; align-items: center; gap: 5px; margin-left: 10px; align-self: center;
    padding: 4px 10px; border: 1px solid var(--accent); border-radius: 5px;
    background: transparent; color: var(--accent); cursor: pointer;
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  }
  h2.editable .edit-btn:hover { background: var(--accent); color: var(--bg-dark, #0f0f1a); }
  /* Same pill as the edit button but neutral, so copying the title reads as the
     secondary action of the pair. */
  h2.editable .copy-btn {
    display: inline-flex; align-items: center; gap: 5px; margin-left: 10px; align-self: center;
    padding: 4px 10px; border: 1px solid var(--border-glass); border-radius: 5px;
    background: transparent; color: var(--text-secondary); cursor: pointer;
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  }
  h2.editable .copy-btn:hover { border-color: var(--accent-border); color: var(--accent); }
  h2.editable .copy-btn.ok { border-color: var(--green-border); color: var(--green); }
  .title-edit { display: flex; gap: 6px; align-items: center; }
  .title-input { flex: 1; background: var(--bg-dark, #0f0f1a); border: 1px solid var(--accent-border); color: var(--text-primary); padding: 8px 12px; border-radius: 6px; font-size: 28px; font-family: system-ui, -apple-system, sans-serif; font-weight: 700; }

  /* Inline-editable field block (description, services/tags). In edit mode every
     field renders together, so there's no per-field header row anymore. */
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field-edit { background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 8px; border-radius: 6px; resize: vertical; font-family: inherit; font-size: 13px; line-height: 1.5; }
  .field-input { background: var(--bg-dark, #0f0f1a); border: 1px solid var(--accent-border); color: var(--text-primary); padding: 5px 8px; border-radius: 4px; font-size: 13px; font-family: inherit; width: 100%; box-sizing: border-box; }
  .chip-label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--text-muted); }
  .field-actions { display: flex; gap: 8px; }
  .field-actions button { padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .field-actions .primary { background: var(--accent-dim); border: 1px solid var(--accent-border); color: var(--accent); }
  .field-actions .ghost { background: transparent; border: 1px solid var(--border-glass); color: var(--text-muted); }
  /* Status picker: a button showing the current status (coloured glyph) that opens a
     popover of options. Replaces the bare <select> — same click-backdrop pattern as the
     note/snooze menus. */
  .status-wrap { position: relative; display: inline-flex; }
  /* The current status is a tinted pill in its own colour (same recipe as the
     countdown chip), so it reads from across the room instead of as a grey select. */
  .status-btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; font-size: 13px; font-weight: 700; font-family: inherit; cursor: pointer;
    background: color-mix(in srgb, var(--st, var(--text-secondary)) 20%, transparent); border: 1px solid color-mix(in srgb, var(--st, var(--text-secondary)) 55%, transparent); color: var(--st, var(--text-primary)); }
  .status-btn:hover { background: color-mix(in srgb, var(--st, var(--text-secondary)) 30%, transparent); }
  .status-btn.st-pending { --st: var(--link); }
  .status-btn.st-in_progress { --st: var(--accent); }
  .status-btn.st-snoozed { --st: var(--amber); }
  .status-btn.st-done { --st: var(--green); }
  .status-btn.st-shelved { --st: var(--red); }
  .status-backdrop { position: fixed; inset: 0; z-index: 5; }
  .status-menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 10; display: flex; flex-direction: column; min-width: 168px; padding: 4px; background: var(--bg-dark, #0f0f1a); border: 1px solid var(--border-glass); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
  .status-opt { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 9px; background: transparent; border: none; border-radius: 5px; color: var(--text-secondary); font-size: 12px; font-family: inherit; text-align: left; cursor: pointer; }
  .status-opt:hover { background: var(--bg-glass-hover); color: var(--text-primary); }
  .status-opt.sel { background: var(--bg-glass); color: var(--text-primary); }
  /* Per-status glyph tint, shared by the button and the menu options. */
  .st-ico { display: inline-flex; }
  .st-pending { color: var(--text-muted); }
  .st-in_progress { color: var(--accent); }
  .st-snoozed { color: var(--amber); }
  .st-done { color: var(--green); }
  .st-shelved { color: var(--red); }
  /* Two-class specificity beats the shared `.md` rule so the description reads larger
     than the notes/steps without bumping their size too. */
  .summary.md { color: var(--text-primary); font-size: 18px; line-height: 1.65; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { font-size: 11px; padding: 2px 8px; border-radius: 999px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
  .chip.svc { background: color-mix(in srgb, var(--svc, var(--accent)) 14%, transparent); border: 1px solid color-mix(in srgb, var(--svc, var(--accent)) 38%, transparent); color: var(--svc, var(--accent)); font-weight: 500; }
  .chip.svc:hover { background: color-mix(in srgb, var(--svc, var(--accent)) 22%, transparent); }
  .chip.tag { background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-muted); }
  .chip.tag:hover { background: var(--bg-glass-hover); color: var(--text-secondary); }
  .cwd { font-size: 12px; color: var(--text-muted); display: flex; flex-direction: column; gap: 2px; padding: 8px; background: var(--bg-glass); border-radius: 6px; }
  .cwd code { color: var(--text-secondary); font-size: 11px; }
  /* Dependencies block: prerequisites (removable) + a picker, then a read-only
     "blocks" list of dependents. */
  .deps { display: flex; flex-direction: column; gap: 6px; }
  /* Each prerequisite / dependent renders as a real (compact) TaskCard, stacked as
     a chain. A slim unlink control sits beside prerequisites only. */
  .dep-chain { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  /* Down-chain connector between stacked nodes (direction: prerequisite → this task). */
  .dep-chain .dep-node + .dep-node { position: relative; }
  .dep-chain .dep-node + .dep-node::before {
    content: ''; position: absolute; left: 16px; top: -8px; height: 8px; width: 2px;
    background: color-mix(in srgb, var(--amber, #d9a441) 45%, transparent); }
  .dep-node { display: flex; align-items: stretch; gap: 6px; }
  .dep-card { flex: 1 1 auto; min-width: 0; }
  .dep-open { flex: 1; text-align: left; background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-secondary); border-radius: 5px; font-size: 12px; font-family: inherit; padding: 4px 8px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dep-open:hover { background: var(--bg-glass-hover); color: var(--text-primary); }
  .dep-rm { flex: 0 0 auto; align-self: stretch; display: inline-flex; align-items: center; justify-content: center; width: 26px;
    background: transparent; border: 1px solid var(--border-glass); color: var(--text-muted); border-radius: 5px; cursor: pointer; }
  .dep-rm:hover { color: var(--amber); border-color: color-mix(in srgb, var(--amber, #d9a441) 40%, transparent); }
  /* Prerequisite picker: a search field with a dropdown of matches, plus the way out
     to the agenda when the right task is easier to spot among the cards. */
  .deps-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .deps-head > span { display: inline-flex; align-items: center; gap: 4px; }
  .dep-search { margin-top: 2px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 5px 8px; background: var(--bg-dark, #0f0f1a); border: 1px solid var(--accent-border); border-radius: 6px; color: var(--text-muted); }
  .dep-search:focus-within, .dep-search.open { border-color: var(--accent); color: var(--accent); }
  .dep-search input { flex: 1; min-width: 0; background: none; border: none; outline: none; font: inherit; font-size: 12px; color: var(--text-primary); }
  .dep-search input::placeholder { color: var(--text-muted); }
  .dep-list { flex: 1 0 100%; list-style: none; margin: 4px -4px 0; padding: 4px 0 0; max-height: 280px; overflow-y: auto; border-top: 1px solid var(--border-glass); }
  .dep-list button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 9px; background: transparent; border: none; border-radius: 5px; color: var(--text-secondary); font-size: 12px; font-family: inherit; text-align: left; cursor: pointer; }
  .dep-list button.cur { background: var(--bg-glass-hover); color: var(--text-primary); }
  .dep-list .dep-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dep-list .dep-due { flex: 0 0 auto; font-size: 11px; color: var(--text-muted); }
  .dep-none { padding: 7px 9px; font-size: 12px; color: var(--text-muted); }
  .dep-agenda { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; font-size: 11px; text-transform: none; letter-spacing: 0; font-weight: 500; }
  .req-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .req-val { display: inline-flex; align-items: center; gap: 6px; color: var(--accent); font-weight: 500; }
  .req-self { color: var(--text-secondary); }
  /* The client value doubles as the link to its page; kept neutral like the card chip. */
  .client-val { color: var(--text-primary); text-decoration: none; }
  .client-val:hover { color: var(--accent); }
  /* Muted "promote this requester into the sidebar roster" affordance. */
  .add-req { font-size: 11px; color: var(--text-muted); }
  .add-req:hover { color: var(--accent); }
  .req-edit { background: var(--bg-dark, #0f0f1a); border: 1px solid var(--accent-border); color: var(--text-primary); padding: 3px 8px; border-radius: 4px; font-size: 12px; font-family: inherit; min-width: 200px; }
  .due-wrap { position: relative; display: inline-flex; }
  .due-btn { display: inline-flex; align-items: center; gap: 5px; background: transparent; border: 1px dashed var(--accent-border); border-radius: 4px; color: var(--text-primary); padding: 3px 8px; font-size: 12px; font-family: inherit; cursor: pointer; }
  .due-btn:hover { border-color: var(--accent); color: var(--accent); }
  /* Visually hidden but not display:none — showPicker() needs a rendered input,
     and it anchors the native calendar popup here. */
  .due-native { position: absolute; inset: 0; opacity: 0; pointer-events: none; border: 0; padding: 0; }
  .req-btn { background: var(--accent-dim); border: 1px solid var(--accent-border); color: var(--accent); padding: 3px 9px; border-radius: 4px; cursor: pointer; font-size: 11px; }
  .req-btn.ghost { background: transparent; border-color: var(--border-glass); color: var(--text-muted); }
  /* Work/personal toggle: a sliding switch. Off (left) = work/default (purple),
     on (right) = the hidden personal-like scope (cyan). */
  .switch { display: inline-flex; align-items: center; gap: 9px; background: transparent; border: none; padding: 0; cursor: pointer; font-family: inherit; }
  .sw-label { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: var(--text-muted); transition: color 0.15s; }
  /* Read-only scope indicator: glyph + label, tinted by which scope it is. */
  .scope-now { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--accent); }
  .scope-now.personal { color: var(--personal); }
  .switch:not(.on) .sw-label.off { color: var(--accent); font-weight: 600; }
  .switch.on .sw-label.on { color: var(--personal); font-weight: 600; }
  .sw-track { position: relative; width: 44px; height: 24px; border-radius: 999px; background: var(--accent-dim); border: 1px solid var(--accent-border); transition: background 0.15s, border-color 0.15s; }
  .switch.on .sw-track { background: var(--personal-dim); border-color: var(--personal-border); }
  .sw-knob { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--accent); transition: transform 0.18s ease, background 0.15s; }
  .switch.on .sw-knob { transform: translateX(20px); background: var(--personal); }
  .switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 999px; }

  /* Closing handoff message: the text to give the requester. Lives at the bottom of
     the plan column and is pushed to the very end of it, so reading the panes left to
     right it lands after the last numbered step — the handoff IS the final step. */
  .col-plan .closing { margin-top: auto; }
  .closing { background: var(--green-dim, var(--bg-glass)); border: 1px solid var(--green-border, var(--border-glass)); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
  .closing.empty-box { background: var(--bg-glass); border-style: dashed; }
  .closing-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .closing-head h3 { margin: 0; display: inline-flex; align-items: center; gap: 5px; color: var(--green, var(--text-secondary)); }
  .closing-actions { display: inline-flex; gap: 6px; }
  .closing-body { color: var(--text-primary); }
  .closing-edit { background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 8px; border-radius: 6px; resize: vertical; font-family: inherit; font-size: 13px; line-height: 1.5; }

  /* Three reading panes: left = identity (title + description + meta), middle =
     backward timeline of notes, right = forward plan. Each pane scrolls on its own
     so the big title and the column headers stay put on wide screens. */
  .layout {
    flex: 1; min-height: 0;
    display: grid;
    grid-template-columns: minmax(320px, 1fr) minmax(0, 1.5fr) minmax(320px, 1fr);
    gap: 0;
  }
  .col-left, .col-notes, .col-plan {
    min-height: 0; overflow-y: auto;
    display: flex; flex-direction: column; gap: 16px;
    padding: 2px 30px;
  }
  .col-left { padding-left: 2px; }
  .col-plan { padding-right: 6px; }
  .col-left, .col-notes { border-right: 1px solid var(--border-glass); }

  @media (max-width: 1080px) {
    .panel { overflow-y: auto; }
    /* Stacked: the panel scrolls, so the columns must take their natural height —
       leaving them flex:1 squeezed them into the panel and the text overlapped. */
    .layout { display: flex; flex-direction: column; gap: 26px; flex: 0 0 auto; }
    .col-left, .col-notes, .col-plan { overflow: visible; padding: 0; border-right: none; }
    .col-left, .col-notes { border-bottom: 1px solid var(--border-glass); padding-bottom: 22px; }
    .head-main { flex-direction: column; align-items: stretch; gap: 12px; }
    .head-main > .cwd { max-width: none; margin-left: 0; padding: 12px 0 0; border-left: none; border-top: 1px solid var(--border-glass); }
  }

  h3 { font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); margin-top: 4px; }
  .notes { display: flex; flex-direction: column; gap: 8px; }
  /* Vertical rail so the notes read as a chronological progress log. */
  .notes.timeline { position: relative; padding-left: 20px; }
  .notes.timeline::before { content: ''; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 2px; background: var(--border-glass); }
  .note { background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 8px; padding: 14px 16px; min-width: 0; overflow-wrap: anywhere; }
  .notes.timeline .note { position: relative; }
  .notes.timeline .note::before { content: ''; position: absolute; left: -18px; top: 17px; width: 9px; height: 9px; border-radius: 50%; background: var(--text-muted); box-shadow: 0 0 0 3px rgba(15, 15, 26, 0.95); }
  /* Newest note is the current state — highlight it. */
  .notes.timeline .note:last-child::before { background: var(--accent); box-shadow: 0 0 0 3px rgba(15, 15, 26, 0.95), 0 0 6px var(--accent); }
  .note header { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
  .note .nh { display: inline-flex; align-items: center; gap: 5px; }
  .note .hdr-right { display: inline-flex; align-items: center; gap: 6px; }
  .note .rel { color: var(--text-muted); white-space: nowrap; }
  /* One ⋯ button per note replaces the old edit + delete pair; it reveals on hover
     (or stays lit while its menu is open) and opens a small actions popover. */
  .note-menu-wrap { position: relative; display: inline-flex; }
  .note-act { display: inline-flex; align-items: center; background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 2px 3px; border-radius: 4px; opacity: 0; transition: opacity 0.12s, color 0.12s, background 0.12s; }
  .note:hover .note-act, .note-act[aria-expanded="true"] { opacity: 1; }
  .note-act:hover, .note-act[aria-expanded="true"] { color: var(--text-primary); background: var(--bg-glass-hover); }
  /* Transparent catcher so a click anywhere closes the open menu. Inside the panel's
     stacking context so the menu (z 10) can sit above it (z 5). */
  .menu-backdrop { position: fixed; inset: 0; z-index: 5; }
  .note-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 10; display: flex; flex-direction: column; min-width: 134px; padding: 4px; background: var(--bg-dark, #0f0f1a); border: 1px solid var(--border-glass); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
  .note-menu button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 9px; background: transparent; border: none; border-radius: 5px; color: var(--text-secondary); font-size: 12px; font-family: inherit; text-align: left; cursor: pointer; }
  .note-menu button:hover { background: var(--bg-glass-hover); color: var(--text-primary); }
  .note-menu button.danger:hover { color: var(--amber); }
  .note-head { font-weight: 600; color: var(--text-primary); font-size: 16px; line-height: 1.45; margin-bottom: 6px; overflow-wrap: anywhere; word-break: break-word; }
  .note-head :global(p) { margin: 0; }
  .note-head :global(a) { color: var(--link); }
  .note-head :global(code) { background: var(--bg-glass-hover); padding: 1px 5px; border-radius: 3px; font-size: 12px; }

  /* Forward-plan boxes. */
  .steps-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .steps-head h3 { margin-top: 8px; }
  .link-btn { background: transparent; border: none; color: var(--accent); cursor: pointer; font-size: 12px; padding: 2px 4px; }
  .link-btn:hover { color: var(--link-hover); text-decoration: underline; }
  .steps { list-style: none; display: flex; flex-direction: column; gap: 10px; padding: 0; margin: 0; }
  .step-box { display: flex; gap: 12px; align-items: flex-start; background: var(--accent-dim); border: 1px solid var(--accent-border); border-radius: 10px; padding: 14px 16px; }
  .step-num { flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: var(--bg-dark, #0f0f1a); font-size: 14px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; margin-top: 1px; }
  .step-text { color: var(--text-primary); }
  .steps-edit { background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 8px; border-radius: 6px; resize: vertical; font-family: inherit; font-size: 13px; line-height: 1.5; }
  .steps-actions { display: flex; gap: 8px; }
  .steps-actions button { padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .steps-actions .primary { background: var(--accent-dim); border: 1px solid var(--accent-border); color: var(--accent); }
  .steps-actions .ghost { background: transparent; border: 1px solid var(--border-glass); color: var(--text-muted); }
  .hint { font-size: 11px; color: var(--text-muted); line-height: 1.4; }

  .md { color: var(--text-primary); font-size: 15px; line-height: 1.6; overflow-wrap: anywhere; word-break: break-word; }
  .md :global(> :first-child) { margin-top: 0; }
  .md :global(> :last-child) { margin-bottom: 0; }
  .md :global(p) { margin: 6px 0; }
  .md :global(ul), .md :global(ol) { margin: 6px 0; padding-left: 22px; }
  .md :global(li) { margin: 2px 0; }
  .md :global(li input[type="checkbox"]) { margin-right: 6px; }
  .md :global(code) { background: var(--bg-glass-hover); padding: 1px 5px; border-radius: 3px; font-size: 13px; }
  .md :global(pre) { background: var(--bg-glass-hover); padding: 8px 10px; border-radius: 4px; overflow-x: auto; margin: 6px 0; max-width: 100%; white-space: pre; word-break: normal; overflow-wrap: normal; }
  .md :global(pre code) { background: transparent; padding: 0; font-size: 13px; }
  .md :global(blockquote) { border-left: 3px solid var(--accent-border); padding-left: 10px; color: var(--text-secondary); margin: 6px 0; }
  .md :global(h1), .md :global(h2), .md :global(h3), .md :global(h4) { margin: 10px 0 4px; color: var(--text-primary); }
  .md :global(h1) { font-size: 18px; } .md :global(h2) { font-size: 17px; } .md :global(h3) { font-size: 15px; }
  .md :global(a) { color: var(--link); }
  .md :global(a:hover) { color: var(--link-hover); }
  .md :global(hr) { border: none; border-top: 1px solid var(--border-glass); margin: 10px 0; }
  .md :global(table) { border-collapse: collapse; margin: 6px 0; }
  .md :global(th), .md :global(td) { border: 1px solid var(--border-glass); padding: 4px 8px; font-size: 12px; }
  .note a { color: var(--link); word-break: break-all; }
  .empty { color: var(--text-muted); font-size: 14px; }
  .add-note { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
  .add-note textarea { background: var(--bg-glass); border: 1px solid var(--border-glass); color: var(--text-primary); padding: 10px; border-radius: 6px; resize: vertical; font-family: inherit; font-size: 14px; }
  .add-note button { background: var(--accent-dim); border: 1px solid var(--accent-border); color: var(--accent); padding: 6px 12px; border-radius: 4px; cursor: pointer; align-self: flex-start; }
  .add-note button:disabled { opacity: 0.4; cursor: not-allowed; }
  .state { padding: 20px; text-align: center; color: var(--text-muted); }
  .state.err { color: var(--amber); }
</style>
