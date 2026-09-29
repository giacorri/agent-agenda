<script lang="ts">
  import { api } from '$lib/api';
  import { config } from '$lib/stores/config';
  import Icon from '$lib/components/Icon.svelte';
  import ScopeIcon from '$lib/components/ScopeIcon.svelte';
  import PersonAvatar from '$lib/components/PersonAvatar.svelte';
  import ClientLogo from '$lib/components/ClientLogo.svelte';
  import { downscaleToDataUrl } from '$lib/image';
  import * as m from '$lib/paraglide/messages';
  import { getLocale, setLocale, locales, type Locale } from '$lib/i18n';
  import type { Category, Person, Client, RefMapping, ScopeDef } from '$lib/types';

  // Language endonyms — names stay in their own language, so they aren't translated.
  const LANG_NAMES: Record<string, string> = { en: 'English', it: 'Italiano' };
  const lang = getLocale();

  // Curated icon set offered by the category picker (full set lives in Icon.svelte).
  const ICONS = [
    'shield', 'package', 'gear', 'document', 'bot', 'server', 'database', 'calendar',
    'layers', 'monitor', 'cpu', 'headphones', 'music', 'tuner', 'mushroom', 'rocket',
    'book', 'cloud', 'wrench', 'beaker', 'spark', 'bell', 'key', 'lock', 'chart', 'tag', 'dot',
  ];
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const OWNER_REPO = /^[^/\s]+\/[^/\s]+$/;

  let err = $state('');
  const fail = (e: unknown) => { err = e instanceof Error ? e.message : String(e); };
  const has = (arr: { key?: string; shorthand?: string }[], id: string) =>
    arr.some((x) => (x.key ?? x.shorthand) === id);

  // ---- categories ----------------------------------------------------------
  const blankCat = (): Category => ({ key: '', label: '', icon: 'dot', color: '#a78bfa', kind: 'service', sort: 0, exam_date: '', start_date: '', review_days: null });
  let cat = $state<Category>(blankCat());
  let catEditing = $state(false);
  // Normalise subject dates to YYYY-MM-DD so the date inputs accept them.
  function editCat(c: Category) {
    cat = { ...c, exam_date: (c.exam_date ?? '').slice(0, 10), start_date: (c.start_date ?? '').slice(0, 10), review_days: c.review_days ?? null };
    catEditing = true; err = '';
  }
  function resetCat() { cat = blankCat(); catEditing = false; }
  async function saveCat() {
    err = '';
    const key = cat.key.trim().toLowerCase();
    if (!key) return (err = m.set_err_cat_key());
    if (!HEX.test(cat.color)) return (err = m.set_err_color());
    if (cat.kind === 'subject' && !(cat.exam_date ?? '').trim()) return (err = m.set_err_exam_date());
    if (!catEditing && has($config.categories, key)) return (err = m.set_err_cat_exists({ key }));
    try { await api.saveCategory({ ...cat, key, label: cat.label.trim() || key }); resetCat(); } catch (e) { fail(e); }
  }
  const delCat = (key: string) => api.deleteCategory(key).catch(fail);
  const distribute = (key: string) => api.distributeSubject(key).catch(fail);

  // ---- people --------------------------------------------------------------
  const blankPerson = (): Person => ({ key: '', label: '', role: '', sort: 0, photo: '' });
  let person = $state<Person>(blankPerson());
  let personEditing = $state(false);
  function editPerson(p: Person) { person = { ...p }; personEditing = true; err = ''; }
  function resetPerson() { person = blankPerson(); personEditing = false; }
  async function savePerson() {
    err = '';
    const key = person.key.trim();
    if (!key) return (err = m.set_err_person_key());
    if (!personEditing && has($config.people, key)) return (err = m.set_err_person_exists({ key }));
    try { await api.savePerson({ ...person, key, label: person.label.trim() || key }); resetPerson(); } catch (e) { fail(e); }
  }
  const delPerson = (key: string) => api.deletePerson(key).catch(fail);
  // The picked file is downscaled to an inline data URL (no upload endpoint):
  // config rows travel in the /api/config bundle, so they have to stay light.
  async function pickImage(e: Event, apply: (dataUrl: string) => void) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try { apply(await downscaleToDataUrl(file)); } catch (ex) { fail(ex); }
  }

  // ---- clients -------------------------------------------------------------
  const blankClient = (): Client => ({ key: '', label: '', sort: 0, logo: '' });
  let client = $state<Client>(blankClient());
  let clientEditing = $state(false);
  function editClient(c: Client) { client = { ...c }; clientEditing = true; err = ''; }
  function resetClient() { client = blankClient(); clientEditing = false; }
  async function saveClient() {
    err = '';
    const key = client.key.trim();
    if (!key) return (err = m.set_err_client_key());
    if (!clientEditing && has($config.clients, key)) return (err = m.set_err_client_exists({ key }));
    try { await api.saveClient({ ...client, key, label: client.label.trim() || key }); resetClient(); } catch (e) { fail(e); }
  }
  const delClient = (key: string) => api.deleteClient(key).catch(fail);

  // ---- ref mappings --------------------------------------------------------
  const blankRef = (): RefMapping => ({ shorthand: '', owner_repo: '', host: 'github.com' });
  let ref = $state<RefMapping>(blankRef());
  let refEditing = $state(false);
  function editRef(r: RefMapping) { ref = { ...r }; refEditing = true; err = ''; }
  function resetRef() { ref = blankRef(); refEditing = false; }
  async function saveRef() {
    err = '';
    const shorthand = ref.shorthand.trim().toLowerCase();
    if (!shorthand) return (err = m.set_err_ref_shorthand());
    if (!OWNER_REPO.test(ref.owner_repo.trim())) return (err = m.set_err_owner_repo());
    if (!refEditing && has($config.refs, shorthand)) return (err = m.set_err_ref_exists({ key: shorthand }));
    try { await api.saveRef({ shorthand, owner_repo: ref.owner_repo.trim(), host: ref.host.trim() || 'github.com' }); resetRef(); } catch (e) { fail(e); }
  }
  const delRef = (shorthand: string) => api.deleteRef(shorthand).catch(fail);

  // ---- scopes --------------------------------------------------------------
  const blankScope = (): ScopeDef => ({ key: '', label: '', tag: '', sort: 0, icon: '' });
  let scopeRow = $state<ScopeDef>(blankScope());
  let scopeEditing = $state(false);
  function editScope(s: ScopeDef) { scopeRow = { ...s }; scopeEditing = true; err = ''; }
  function resetScope() { scopeRow = blankScope(); scopeEditing = false; }
  async function saveScope() {
    err = '';
    const key = scopeRow.key.trim().toLowerCase();
    if (!key) return (err = m.set_err_scope_key());
    if (!scopeEditing && has($config.scopes, key)) return (err = m.set_err_scope_exists({ key }));
    try { await api.saveScope({ ...scopeRow, key, label: scopeRow.label.trim() || key, tag: scopeRow.tag.trim(), icon: (scopeRow.icon ?? '').trim() }); resetScope(); } catch (e) { fail(e); }
  }
  const delScope = (key: string) => api.deleteScope(key).catch(fail);

  // ---- defaults ----------------------------------------------------
  let remindTime = $state('09:30');
  let remindBefore = $state('0');
  let defaultsLoaded = false;
  $effect(() => {
    const s = $config.settings;
    if (defaultsLoaded) return; // populate once; don't clobber edits on later config refreshes
    remindTime = s.default_remind_time ?? '09:30';
    remindBefore = s.default_remind_before_min ?? '0';
    defaultsLoaded = true;
  });
  async function saveDefaults() {
    err = '';
    try {
      await api.patchSettings({
        default_remind_time: remindTime,
        default_remind_before_min: String(Number.parseInt(remindBefore, 10) || 0),
      });
    } catch (e) { fail(e); }
  }

  const isEmpty = $derived(
    !$config.categories.length && !$config.people.length && !$config.clients.length &&
    !$config.refs.length && !$config.scopes.length
  );
</script>

<div class="view">
  <header>
    <a href="/" class="back">{m.back_agenda()}</a>
    <h1><Icon name="gear" size={22} /> {m.settings_title()}</h1>
    <a class="wizard-link" href="/onboarding"><Icon name="rocket" size={13} /> {m.wiz_title()}</a>
  </header>

  {#if err}<div class="err">{err}</div>{/if}
  {#if isEmpty}
    <p class="hint">{m.set_hint_empty()}</p>
  {/if}

  <!-- Categories -->
  <section>
    <h2><Icon name="layers" size={16} /> {m.set_sec_categories()}</h2>
    <ul class="rows">
      {#each $config.categories as c (c.key)}
        <li>
          <span class="swatch" style={`background:${c.color}`}></span>
          <Icon name={c.icon} size={15} />
          <span class="rk">{c.label}</span>
          <span class="rsub">{c.key} · {c.kind === 'subject' && c.exam_date ? `${m.study_exam()} ${c.exam_date.slice(0, 10)}` : c.kind}</span>
          {#if c.kind === 'subject' && c.exam_date}<button class="mini" onclick={() => distribute(c.key)}>{m.study_distribute()}</button>{/if}
          <button class="mini" onclick={() => editCat(c)}>{m.common_edit_lower()}</button>
          <button class="mini del" onclick={() => delCat(c.key)} aria-label={m.tc_delete()}><Icon name="trash" size={13} /></button>
        </li>
      {/each}
    </ul>
    <div class="form">
      <input class="in key" placeholder={m.set_cat_key_ph()} bind:value={cat.key} disabled={catEditing} />
      <input class="in" placeholder={m.set_label_ph()} bind:value={cat.label} />
      <select class="in sel" bind:value={cat.kind}>
        <option value="service">{m.wiz_kind_service()}</option>
        <option value="app">{m.wiz_kind_app()}</option>
        <option value="subject">{m.study_kind_subject()}</option>
      </select>
      <input class="in color" type="color" bind:value={cat.color} aria-label={m.set_color_aria()} />
      {#if cat.kind === 'subject'}
        <label class="fld">{m.set_exam_date()} <input class="in" type="date" bind:value={cat.exam_date} /></label>
        <label class="fld">{m.set_start_date()} <input class="in" type="date" bind:value={cat.start_date} /></label>
        <label class="fld">{m.set_review_days()} <input class="in rev" type="number" min="0" bind:value={cat.review_days} /></label>
      {/if}
      <div class="iconpick">
        {#each ICONS as ic}
          <button class="ip" class:on={cat.icon === ic} title={ic} onclick={() => (cat.icon = ic)}><Icon name={ic} size={14} /></button>
        {/each}
      </div>
      <div class="acts">
        <button class="primary" onclick={saveCat}>{catEditing ? m.common_save() : m.set_add()}</button>
        {#if catEditing}<button class="ghost" onclick={resetCat}>{m.common_cancel()}</button>{/if}
      </div>
    </div>
  </section>

  <!-- People -->
  <section>
    <h2><Icon name="user" size={16} /> {m.set_sec_people()}</h2>
    <ul class="rows">
      {#each $config.people as p (p.key)}
        <li>
          <PersonAvatar photo={p.photo} size={16} alt={p.label} />
          <span class="rk">{p.label}</span>
          <span class="rsub">{p.key}{p.role ? ` · ${p.role}` : ''}</span>
          <button class="mini" onclick={() => editPerson(p)}>{m.common_edit_lower()}</button>
          <button class="mini del" onclick={() => delPerson(p.key)} aria-label={m.tc_delete()}><Icon name="trash" size={13} /></button>
        </li>
      {/each}
    </ul>
    <div class="form">
      <input class="in key" placeholder={m.set_person_key_ph()} bind:value={person.key} disabled={personEditing} />
      <input class="in" placeholder={m.set_label_ph()} bind:value={person.label} />
      <input class="in" placeholder={m.set_role_ph()} bind:value={person.role} />
      <label class="photo-field">
        <PersonAvatar photo={person.photo} size={28} alt={person.label} />
        <input type="file" accept="image/*" title={m.set_photo_ph()} onchange={(e) => pickImage(e, (d) => (person.photo = d))} />
        {#if person.photo}<button type="button" class="mini del" onclick={() => (person.photo = '')} aria-label={m.tc_delete()}><Icon name="trash" size={13} /></button>{/if}
      </label>
      <div class="acts">
        <button class="primary" onclick={savePerson}>{personEditing ? m.common_save() : m.set_add()}</button>
        {#if personEditing}<button class="ghost" onclick={resetPerson}>{m.common_cancel()}</button>{/if}
      </div>
    </div>
  </section>

  <!-- Clients / companies -->
  <section>
    <h2><Icon name="building" size={16} /> {m.set_sec_clients()}</h2>
    <ul class="rows">
      {#each $config.clients as c (c.key)}
        <li>
          <ClientLogo logo={c.logo} size={16} alt={c.label} />
          <span class="rk">{c.label}</span>
          <span class="rsub">{c.key}</span>
          <button class="mini" onclick={() => editClient(c)}>{m.common_edit_lower()}</button>
          <button class="mini del" onclick={() => delClient(c.key)} aria-label={m.tc_delete()}><Icon name="trash" size={13} /></button>
        </li>
      {/each}
    </ul>
    <div class="form">
      <input class="in key" placeholder={m.set_client_key_ph()} bind:value={client.key} disabled={clientEditing} />
      <input class="in" placeholder={m.set_label_ph()} bind:value={client.label} />
      <label class="photo-field">
        <ClientLogo logo={client.logo} size={28} alt={client.label} />
        <input type="file" accept="image/*" title={m.set_logo_ph()} onchange={(e) => pickImage(e, (d) => (client.logo = d))} />
        {#if client.logo}<button type="button" class="mini del" onclick={() => (client.logo = '')} aria-label={m.tc_delete()}><Icon name="trash" size={13} /></button>{/if}
      </label>
      <div class="acts">
        <button class="primary" onclick={saveClient}>{clientEditing ? m.common_save() : m.set_add()}</button>
        {#if clientEditing}<button class="ghost" onclick={resetClient}>{m.common_cancel()}</button>{/if}
      </div>
    </div>
  </section>

  <!-- Ref mappings -->
  <section>
    <h2><Icon name="link" size={16} /> {m.set_sec_refs()}</h2>
    <ul class="rows">
      {#each $config.refs as r (r.shorthand)}
        <li>
          <Icon name="link" size={15} />
          <span class="rk">{r.shorthand}</span>
          <span class="rsub">{r.host}/{r.owner_repo}</span>
          <button class="mini" onclick={() => editRef(r)}>{m.common_edit_lower()}</button>
          <button class="mini del" onclick={() => delRef(r.shorthand)} aria-label={m.tc_delete()}><Icon name="trash" size={13} /></button>
        </li>
      {/each}
    </ul>
    <div class="form">
      <input class="in key" placeholder={m.set_ref_shorthand_ph()} bind:value={ref.shorthand} disabled={refEditing} />
      <input class="in" placeholder={m.set_owner_repo_ph()} bind:value={ref.owner_repo} />
      <input class="in" placeholder={m.set_host_ph()} bind:value={ref.host} />
      <div class="acts">
        <button class="primary" onclick={saveRef}>{refEditing ? m.common_save() : m.set_add()}</button>
        {#if refEditing}<button class="ghost" onclick={resetRef}>{m.common_cancel()}</button>{/if}
      </div>
    </div>
  </section>

  <!-- Scopes -->
  <section>
    <h2><Icon name="eye" size={16} /> {m.set_sec_scopes()}</h2>
    <p class="sub">{m.set_scopes_help()}</p>
    <ul class="rows">
      {#each $config.scopes as s (s.key)}
        <li>
          <ScopeIcon icon={s.icon} size={15} />
          <span class="rk">{s.label}</span>
          <span class="rsub">{s.key}{s.tag ? ` · #${s.tag}` : ' · default'}</span>
          <button class="mini" onclick={() => editScope(s)}>{m.common_edit_lower()}</button>
          <button class="mini del" onclick={() => delScope(s.key)} aria-label={m.tc_delete()}><Icon name="trash" size={13} /></button>
        </li>
      {/each}
    </ul>
    <div class="form">
      <input class="in key" placeholder={m.set_scope_key_ph()} bind:value={scopeRow.key} disabled={scopeEditing} />
      <input class="in" placeholder={m.set_label_ph()} bind:value={scopeRow.label} />
      <input class="in" placeholder={m.wiz_scope_tag_ph()} bind:value={scopeRow.tag} />
      <input class="in" placeholder={m.set_scope_icon_ph()} bind:value={scopeRow.icon} />
      <div class="acts">
        <button class="primary" onclick={saveScope}>{scopeEditing ? m.common_save() : m.set_add()}</button>
        {#if scopeEditing}<button class="ghost" onclick={resetScope}>{m.common_cancel()}</button>{/if}
      </div>
    </div>
  </section>

  <!-- Defaults -->
  <section>
    <h2><Icon name="clock" size={16} /> {m.set_sec_defaults()}</h2>
    <div class="form">
      <label class="fld">{m.set_reminder_time()} <input class="in" type="time" bind:value={remindTime} /></label>
      <label class="fld">{m.set_remind_before()} <input class="in" type="number" min="0" bind:value={remindBefore} /></label>
      <div class="acts"><button class="primary" onclick={saveDefaults}>{m.set_save_defaults()}</button></div>
    </div>
  </section>

  <!-- Language — applies instantly (Paraglide persists the choice and reloads). -->
  <section>
    <h2><Icon name="globe" size={16} /> {m.set_sec_language()}</h2>
    <div class="form">
      <select class="in sel" value={lang} aria-label={m.set_sec_language()}
        onchange={(e) => setLocale((e.currentTarget as HTMLSelectElement).value as Locale)}>
        {#each locales as l}<option value={l}>{LANG_NAMES[l] ?? l.toUpperCase()}</option>{/each}
      </select>
    </div>
  </section>
</div>

<style>
  .view { display: flex; flex-direction: column; gap: 22px; overflow-y: auto; padding-right: 8px; max-width: 760px; }
  header { display: flex; align-items: baseline; gap: 16px; }
  .back { color: var(--link); text-decoration: none; font-size: 13px; }
  .wizard-link { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; color: var(--accent); text-decoration: none; font-size: 13px; padding: 4px 10px; border: 1px solid var(--accent-border); border-radius: 6px; background: var(--accent-dim); }
  .wizard-link:hover { filter: brightness(1.1); }
  .back:hover { color: var(--link-hover); }
  h1 { font-size: 22px; display: flex; align-items: center; gap: 8px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
  section { background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 10px; padding: 14px 16px; }
  .hint, .sub { color: var(--text-muted); font-size: 12px; margin-bottom: 8px; }
  .err { color: var(--amber); background: var(--amber-dim); border: 1px solid var(--amber-border); border-radius: 6px; padding: 6px 10px; font-size: 13px; }
  .rows { list-style: none; display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .rows li { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 6px; background: var(--bg-glass-hover); font-size: 13px; }
  .rk { color: var(--text-primary); font-weight: 600; }
  .rsub { color: var(--text-muted); font-size: 11px; flex: 1; }
  .swatch { width: 12px; height: 12px; border-radius: 3px; flex: 0 0 auto; border: 1px solid var(--border-glass); }
  .mini { background: transparent; border: none; color: var(--link); font-size: 12px; cursor: pointer; padding: 2px 4px; font-family: inherit; }
  .mini:hover { color: var(--link-hover); }
  .mini.del { color: var(--text-muted); }
  .mini.del:hover { color: var(--red); }
  .form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .photo-field { display: flex; align-items: center; gap: 8px; flex-basis: 100%; font-size: 12px; color: var(--text-secondary); }
  .in { background: var(--bg-base); border: 1px solid var(--border-glass); border-radius: 6px; padding: 6px 9px; color: var(--text-primary); font-family: inherit; font-size: 13px; }
  .in:focus { outline: none; border-color: var(--accent-border); }
  .in.key { width: 150px; }
  .in.sel { padding: 6px; }
  .in.color { padding: 2px; width: 38px; height: 32px; }
  .in.rev { width: 70px; }
  .fld { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--text-muted); }
  .iconpick { display: flex; flex-wrap: wrap; gap: 3px; width: 100%; }
  .ip { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; background: var(--bg-base); border: 1px solid var(--border-glass); color: var(--text-secondary); cursor: pointer; }
  .ip:hover { color: var(--text-primary); }
  .ip.on { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
  .acts { display: flex; gap: 6px; }
  .primary { background: var(--accent-dim); border: 1px solid var(--accent-border); color: var(--accent); padding: 6px 14px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 13px; }
  .ghost { background: transparent; border: 1px solid var(--border-glass); color: var(--text-secondary); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 13px; }
</style>
