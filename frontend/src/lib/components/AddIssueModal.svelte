<script lang="ts">
  import { api } from '$lib/api';
  import type { Task } from '$lib/types';
  import { config } from '$lib/stores/config';
  import { tasks } from '$lib/stores/tasks';
  import { addOpen, flying, formingId } from '$lib/stores/view';
  import { activeScopeIsHidden } from '$lib/stores/scope';
  import * as m from '$lib/paraglide/messages';
  import Icon from './Icon.svelte';

  let modalEl: HTMLElement;

  let title = $state('');
  let summary = $state('');
  let dateEl: HTMLInputElement;
  // Empty by default: leaving the deadline blank creates a general task in the backlog.
  let whenStr = $state('');
  let requester = $state('');
  let clientStr = $state('');
  let tagsStr = $state('');
  let stepsStr = $state('');
  let selected = $state<string[]>([]); // selected category keys (service/app/subject)
  let blockedById = $state('');        // this task waits on…
  let blocksId = $state('');           // …and blocks this one
  let error = $state('');
  let saving = $state(false);

  const studyTag = $derived($config.scopes.find((s) => s.type === 'study')?.tag ?? 'study');

  // Categories split into their sidebar sections; empty groups drop out.
  const catGroups = $derived(
    [
      { label: m.sidebar_services(), kind: 'service' },
      { label: m.sidebar_apps(), kind: 'app' },
      { label: m.study_subjects(), kind: 'subject' },
    ]
      .map((g) => ({ ...g, items: $config.categories.filter((c) => c.kind === g.kind).sort((a, b) => a.sort - b.sort) }))
      .filter((g) => g.items.length),
  );

  // Open tasks are the only valid dependency targets.
  const openTasks = $derived($tasks.filter((t) => t.status !== 'done' && t.status !== 'shelved'));

  function toggleCat(key: string) {
    selected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
  }

  function close() {
    addOpen.set(false);
    title = ''; summary = ''; whenStr = ''; requester = ''; clientStr = ''; tagsStr = ''; stepsStr = '';
    selected = []; blockedById = ''; blocksId = ''; error = '';
  }

  // Hand off to FlyingCard: capture the modal box + the current card-column width.
  // FlyingCard forms the card in place, then (only after) inserts the real card and
  // flies the ghost to its slot while neighbours make room — kept out of here so the
  // two phases stay strictly sequential.
  function flyIntoAgenda(created: Task) {
    const from = modalEl.getBoundingClientRect();
    const anyCard = document.querySelector<HTMLElement>('.list .card');
    const colW = anyCard?.getBoundingClientRect().width ?? 340;
    // Set formingId now (before the WS broadcast lands the task) so the real card stays
    // out of the layout until FlyingCard is ready to fly it in.
    formingId.set(created.id);
    flying.set({
      from: { x: from.x, y: from.y, w: from.width, h: from.height },
      colW,
      task: created,
    });
    close();
  }

  function splitList(s: string): string[] {
    return s.toLowerCase().split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  }

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (!title.trim() || saving) return;
    saving = true;
    try {
      const cats = selected;
      const isSubject = cats.some((k) => $config.categories.find((c) => c.key === k)?.kind === 'subject');
      const tags = [...splitList(tagsStr), ...(isSubject && studyTag ? [studyTag] : [])];
      const steps = stepsStr.split('\n').map((s) => s.trim()).filter(Boolean);

      const created = await api.ingest({
        title: title.trim(),
        when: whenStr.trim(),
        summary: summary.trim() || undefined,
        requester: requester.trim() || undefined,
        client: clientStr.trim() || undefined,
        services: cats.length ? cats : undefined,
        tags: tags.length ? tags : undefined,
        steps: steps.length ? steps : undefined,
      });

      // Dependencies are best-effort: the task already exists, so a rejected link
      // (cycle/duplicate) shouldn't block creation — fix it from the drawer instead.
      if (blockedById) await api.addDep(created.id, blockedById).catch(() => {});
      if (blocksId) await api.addDep(blocksId, created.id).catch(() => {});

      flyIntoAgenda(created);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  // Bare autofocus, no focus-trap — fine for this form. Add a trap if it grows.
  function autofocus(el: HTMLElement) { el.focus(); }
</script>

<svelte:window onkeydown={(e) => { if ($addOpen && e.key === 'Escape') close(); }} />

{#if $addOpen}
  <div class="overlay" role="presentation" onclick={close}></div>
  <div class="modal" bind:this={modalEl} role="dialog" aria-modal="true" aria-labelledby="qa-title">
    <header>
      <h2 id="qa-title">{m.qa_new()}</h2>
      <button class="close" onclick={close} aria-label={m.common_cancel()}><Icon name="close" size={18} /></button>
    </header>

    <form onsubmit={submit}>
      <label class="field">
        <span class="lbl">{m.qa_l_title()}</span>
        <input use:autofocus placeholder={m.qa_title_ph()} bind:value={title} />
      </label>

      <label class="field">
        <span class="lbl">{m.qa_l_desc()}</span>
        <textarea rows="2" placeholder={m.qa_desc_ph()} bind:value={summary}></textarea>
      </label>

      {#if catGroups.length}
        <div class="field">
          <span class="lbl">{m.qa_categories()}</span>
          <div class="cats">
            {#each catGroups as g}
              <div class="catrow">
                <span class="glabel">{g.label}</span>
                <div class="chips">
                  {#each g.items as c (c.key)}
                    <button type="button" class="chip-t" class:on={selected.includes(c.key)}
                      style={`--cat:${c.color}`} onclick={() => toggleCat(c.key)} aria-pressed={selected.includes(c.key)}>
                      <Icon name={c.icon} size={13} /><span>{c.label}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <label class="field">
        <span class="lbl">{m.sidebar_tags()}</span>
        <input placeholder={m.td_tags_placeholder()} bind:value={tagsStr} />
      </label>

      <div class="row">
        <label class="field">
          <span class="lbl">{m.qa_l_when()}</span>
          <span class="ig">
            <button type="button" class="cal" onclick={() => dateEl.showPicker()} aria-label={m.qa_pick_date()}><Icon name="calendar" size={14} /></button>
            <input placeholder={m.qa_when_default()} bind:value={whenStr} />
            <input type="date" bind:this={dateEl} class="datepick" tabindex="-1" aria-hidden="true"
              onchange={(e) => { const v = e.currentTarget.value; if (v) whenStr = v; }} />
          </span>
          <span class="hint">{m.qa_when_hint()}</span>
        </label>
        <label class="field">
          <span class="lbl">{m.qa_l_who()}</span>
          <span class="ig"><Icon name="user" size={14} /><input list="quickadd-requesters" bind:value={requester} /></span>
          <datalist id="quickadd-requesters">
            {#each $config.people as p}<option value={p.key}></option>{/each}
          </datalist>
        </label>
      </div>

      {#if !$activeScopeIsHidden && $config.clients.length}
        <label class="field">
          <span class="lbl">{m.qa_l_client()}</span>
          <span class="ig"><Icon name="building" size={14} /><input list="quickadd-clients" bind:value={clientStr} /></span>
          <datalist id="quickadd-clients">
            {#each $config.clients as c}<option value={c.key}></option>{/each}
          </datalist>
        </label>
      {/if}

      <label class="field">
        <span class="lbl">{m.td_next_steps()}</span>
        <textarea rows="3" placeholder={m.td_steps_placeholder()} bind:value={stepsStr}></textarea>
      </label>

      {#if openTasks.length}
        <div class="row">
          <label class="field">
            <span class="lbl">{m.td_blocked_by()}</span>
            <select bind:value={blockedById}>
              <option value="">{m.td_add_blocker()}</option>
              {#each openTasks as t (t.id)}<option value={t.id}>{t.title}</option>{/each}
            </select>
          </label>
          <label class="field">
            <span class="lbl">{m.td_blocks()}</span>
            <select bind:value={blocksId}>
              <option value="">{m.qa_blocks_ph()}</option>
              {#each openTasks as t (t.id)}<option value={t.id}>{t.title}</option>{/each}
            </select>
          </label>
        </div>
      {/if}

      {#if error}<div class="err">{error}</div>{/if}

      <footer>
        <button type="button" class="btn ghost" onclick={close}>{m.common_cancel()}</button>
        <button type="submit" class="btn primary" disabled={!title.trim() || saving}>
          <Icon name="plus" size={15} />{m.qa_add()}
        </button>
      </footer>
    </form>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 50; }
  .modal {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto;
    z-index: 51; padding: 22px 24px; border-radius: 14px; box-sizing: border-box;
    background: linear-gradient(135deg, rgba(26, 16, 53, 0.98), rgba(15, 15, 26, 0.98));
    backdrop-filter: blur(20px); border: 1px solid var(--border-glass);
  }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
  h2 { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--text-primary); }
  .close { display: inline-flex; align-items: center; background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 2px; }
  .close:hover { color: var(--text-primary); }

  form { display: flex; flex-direction: column; gap: 14px; }
  .row { display: flex; gap: 14px; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .row .field { flex: 1; }
  .lbl { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
  .hint { font-size: 11px; color: var(--text-muted); }

  input, textarea, select {
    width: 100%; box-sizing: border-box;
    background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 8px;
    padding: 9px 11px; color: var(--text-primary); font-family: inherit; font-size: 14px;
  }
  textarea { resize: vertical; min-height: 48px; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent-border); }
  select option { background: var(--bg-base); color: var(--text-primary); }

  /* Compact fields (deadline / who) keep a leading icon as affordance. */
  .ig { position: relative; display: flex; align-items: center; gap: 8px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 8px; padding: 0 11px; color: var(--text-muted); }
  .ig:focus-within { border-color: var(--accent-border); color: var(--accent); }
  .ig input { flex: 1; min-width: 0; background: transparent; border: none; padding: 9px 0; color: var(--text-primary); font-family: inherit; font-size: 14px; }
  .ig input:focus { outline: none; }
  /* Calendar affordance: button opens the native date picker, which writes into the free-text field. */
  .cal { display: inline-flex; align-items: center; padding: 0; background: none; border: none; color: inherit; cursor: pointer; }
  .cal:hover { color: var(--accent); }
  .ig .datepick { position: absolute; left: 0; bottom: 0; width: 1px; height: 1px; padding: 0; opacity: 0; pointer-events: none; }

  /* Category picker: one wrap-row per kind, chips toggle selection. */
  .cats { display: flex; flex-direction: column; gap: 8px; }
  .catrow { display: flex; gap: 10px; align-items: baseline; }
  .glabel { flex: 0 0 68px; font-size: 11px; color: var(--text-muted); text-align: right; padding-top: 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip-t {
    display: inline-flex; align-items: center; gap: 5px; width: auto;
    padding: 5px 10px; border-radius: 999px; border: 1px solid var(--border-glass);
    background: var(--bg-glass); color: var(--text-secondary); cursor: pointer; font-size: 12px;
  }
  .chip-t :global(svg) { color: var(--cat); }
  .chip-t:hover { color: var(--text-primary); }
  .chip-t.on { border-color: var(--cat); background: var(--accent-dim); color: var(--text-primary); }

  footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; }
  .btn.ghost { background: transparent; border: 1px solid var(--border-glass); color: var(--text-secondary); }
  .btn.ghost:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .btn.primary { background: var(--accent-dim); border: 1px solid var(--accent-border); color: var(--accent); }
  .btn.primary:hover:not(:disabled) { background: var(--accent); color: var(--bg-dark, #0f0f1a); }
  .btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .err { color: var(--amber); font-size: 12px; }
</style>
