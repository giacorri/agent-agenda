<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import * as m from '$lib/paraglide/messages';
  import type { Category, Person, ScopeDef } from '$lib/types';

  const STEPS = 4;
  let step = $state(0);
  let saving = $state(false);
  let error = $state('');

  type ScopeModel = 'single' | 'wp' | 'custom';
  let scopeModel = $state<ScopeModel>('wp');
  let customScopes = $state<{ key: string; label: string; tag: string }[]>([
    { key: '', label: '', tag: '' },
  ]);

  // Categories the user tracks; key + color/icon are derived on finish.
  let cats = $state<{ label: string; kind: 'service' | 'app' }[]>([{ label: '', kind: 'service' }]);
  let ppl = $state<{ label: string; role: string }[]>([{ label: '', role: '' }]);
  let remindTime = $state('09:30');

  const PALETTE = ['#a78bfa', '#fbbf24', '#7dd3fc', '#34d399', '#f472b6', '#fb923c', '#60a5fa', '#22c55e', '#d946ef', '#2dd4bf'];
  const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const addCat = () => (cats = [...cats, { label: '', kind: 'service' }]);
  const addPerson = () => (ppl = [...ppl, { label: '', role: '' }]);
  const addScope = () => (customScopes = [...customScopes, { key: '', label: '', tag: '' }]);

  function buildScopes(): ScopeDef[] {
    if (scopeModel === 'single') return [];
    if (scopeModel === 'wp') {
      return [
        { key: 'work', label: m.wiz_scope_work(), tag: '', sort: 0 },
        { key: 'personal', label: m.wiz_scope_personal(), tag: 'personal', sort: 1 },
      ];
    }
    return customScopes
      .filter((s) => s.label.trim())
      .map((s, i) => ({ key: slug(s.key || s.label), label: s.label.trim(), tag: s.tag.trim(), sort: i }));
  }

  function buildDoc() {
    const categories: Category[] = cats
      .filter((c) => c.label.trim())
      .map((c, i) => ({
        key: slug(c.label),
        label: c.label.trim(),
        icon: c.kind === 'app' ? 'rocket' : 'gear',
        color: PALETTE[i % PALETTE.length],
        kind: c.kind,
        sort: i,
      }));
    const people: Person[] = ppl
      .filter((p) => p.label.trim())
      .map((p, i) => ({ key: p.label.trim(), label: p.label.trim(), role: p.role.trim(), sort: i }));
    const settings: Record<string, string> = remindTime ? { default_remind_time: remindTime } : {};
    return { scopes: buildScopes(), categories, people, settings };
  }

  async function finish() {
    saving = true; error = '';
    try {
      await api.bootstrapConfig(buildDoc());
      await goto('/');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      saving = false;
    }
  }

  const next = () => (step = Math.min(STEPS - 1, step + 1));
  const back = () => (step = Math.max(0, step - 1));

  const doc = $derived(buildDoc());
</script>

<div class="wizard">
  <header>
    <a href="/" class="back">{m.back_agenda()}</a>
    <h1><Icon name="rocket" size={20} /> {m.wiz_title()}</h1>
    <span class="step">{m.wiz_step({ n: step + 1, total: STEPS })}</span>
  </header>

  {#if error}<div class="err">{error}</div>{/if}

  <section class="card glass">
    {#if step === 0}
      <h2>{m.wiz_scope_title()}</h2>
      <div class="opts">
        {#each [['single', m.wiz_scope_single(), m.wiz_scope_single_desc()], ['wp', m.wiz_scope_wp(), m.wiz_scope_wp_desc()], ['custom', m.wiz_scope_custom(), m.wiz_scope_custom_desc()]] as [val, label, desc]}
          <button class="opt" class:on={scopeModel === val} onclick={() => (scopeModel = val as ScopeModel)}>
            <span class="ot">{label}</span><span class="od">{desc}</span>
          </button>
        {/each}
      </div>
      {#if scopeModel === 'custom'}
        <div class="rows">
          {#each customScopes as s (s)}
            <div class="row">
              <input class="in" placeholder={m.wiz_scope_name_ph()} bind:value={s.label} />
              <input class="in" placeholder={m.wiz_scope_tag_ph()} bind:value={s.tag} />
            </div>
          {/each}
          <button class="mini" onclick={addScope}>+ {m.wiz_add_scope()}</button>
        </div>
      {/if}
    {:else if step === 1}
      <h2>{m.wiz_cat_title()}</h2>
      <p class="desc">{m.wiz_cat_desc()}</p>
      <div class="rows">
        {#each cats as c (c)}
          <div class="row">
            <input class="in grow" placeholder={m.wiz_cat_placeholder()} bind:value={c.label} />
            <select class="in" bind:value={c.kind}>
              <option value="service">{m.wiz_kind_service()}</option>
              <option value="app">{m.wiz_kind_app()}</option>
            </select>
          </div>
        {/each}
        <button class="mini" onclick={addCat}>+ {m.wiz_cat_add()}</button>
      </div>
    {:else if step === 2}
      <h2>{m.wiz_people_title()}</h2>
      <p class="desc">{m.wiz_people_desc()}</p>
      <div class="rows">
        {#each ppl as p (p)}
          <div class="row">
            <input class="in grow" placeholder={m.wiz_person_placeholder()} bind:value={p.label} />
            <input class="in" placeholder={m.wiz_role_placeholder()} bind:value={p.role} />
          </div>
        {/each}
        <button class="mini" onclick={addPerson}>+ {m.wiz_people_add()}</button>
      </div>
    {:else}
      <h2>{m.wiz_review_title()}</h2>
      <ul class="review">
        <li><b>{m.sidebar_services()}</b> · {doc.categories.length} — {doc.categories.map((c) => c.label).join(', ') || m.wiz_none_yet()}</li>
        <li><b>{m.sidebar_requesters()}</b> · {doc.people.length} — {doc.people.map((p) => p.label).join(', ') || m.wiz_none_yet()}</li>
        <li><b>{m.scope_aria()}</b> · {doc.scopes.length} — {doc.scopes.map((s) => s.label).join(', ') || m.wiz_scope_single()}</li>
      </ul>
      <label class="fld">{m.wiz_reminder_time()} <input class="in" type="time" bind:value={remindTime} /></label>
    {/if}
  </section>

  <footer>
    {#if step > 0}<button class="ghost" onclick={back}>{m.wiz_back()}</button>{/if}
    <span class="spacer"></span>
    {#if step < STEPS - 1}
      <button class="primary" onclick={next}>{m.wiz_next()}</button>
    {:else}
      <button class="primary" onclick={finish} disabled={saving}>{m.wiz_finish()}</button>
    {/if}
  </footer>
</div>

<style>
  .wizard { display: flex; flex-direction: column; gap: 18px; max-width: 640px; margin: 12px auto; width: 100%; }
  header { display: flex; align-items: baseline; gap: 14px; }
  .back { color: var(--link); text-decoration: none; font-size: 13px; }
  h1 { font-size: 20px; display: flex; align-items: center; gap: 8px; }
  .step { color: var(--text-muted); font-size: 12px; margin-left: auto; }
  .card { padding: 20px; border-radius: 12px; display: flex; flex-direction: column; gap: 12px; }
  h2 { font-size: 16px; }
  .desc { color: var(--text-muted); font-size: 13px; }
  .err { color: var(--amber); background: var(--amber-dim); border: 1px solid var(--amber-border); border-radius: 6px; padding: 6px 10px; font-size: 13px; }
  .opts { display: flex; flex-direction: column; gap: 8px; }
  .opt { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 12px 14px; border-radius: 10px; background: var(--bg-glass); border: 1px solid var(--border-glass); cursor: pointer; }
  .opt:hover { border-color: var(--accent-border); }
  .opt.on { background: var(--accent-dim); border-color: var(--accent-border); }
  .ot { font-weight: 700; color: var(--text-primary); font-size: 14px; }
  .od { font-size: 12px; color: var(--text-muted); }
  .rows { display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; gap: 8px; }
  .in { background: var(--bg-base); border: 1px solid var(--border-glass); border-radius: 6px; padding: 7px 9px; color: var(--text-primary); font-family: inherit; font-size: 13px; }
  .in.grow { flex: 1; }
  .mini { align-self: flex-start; background: transparent; border: none; color: var(--link); font-size: 13px; cursor: pointer; font-family: inherit; padding: 2px 0; }
  .review { list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--text-secondary); }
  .review b { color: var(--text-primary); }
  .fld { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted); }
  footer { display: flex; align-items: center; gap: 8px; }
  .spacer { flex: 1; }
  .primary { background: var(--accent-dim); border: 1px solid var(--accent-border); color: var(--accent); padding: 8px 18px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 14px; }
  .primary:disabled { opacity: 0.6; cursor: default; }
  .ghost { background: transparent; border: 1px solid var(--border-glass); color: var(--text-secondary); padding: 8px 14px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 14px; }
</style>
