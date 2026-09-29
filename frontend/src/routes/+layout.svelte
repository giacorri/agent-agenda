<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { connectWs } from '$lib/ws';
  import { initTaskStream, linkPick, selectedTaskId } from '$lib/stores/tasks';
  import { initConfig } from '$lib/stores/config';
  import { ensureNotificationPermission } from '$lib/notify';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import QuickAdd from '$lib/components/QuickAdd.svelte';
  import AddIssueModal from '$lib/components/AddIssueModal.svelte';
  import FlyingCard from '$lib/components/FlyingCard.svelte';
  import TaskDetail from '$lib/components/TaskDetail.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { viewMode, peekMode, notice } from '$lib/stores/view';
  import * as m from '$lib/paraglide/messages';
  import { getLocale } from '$lib/i18n';
  import { copyCodeOnClick } from '$lib/markdown';

  let { children } = $props();

  const NAV = [
    { href: '/', label: () => m.nav_agenda(), icon: 'note' },
    { href: '/timeline', label: () => m.nav_timeline(), icon: 'chart' },
    { href: '/week', label: () => m.nav_week(), icon: 'calendar' },
    { href: '/month', label: () => m.nav_month(), icon: 'layers' },
  ];
  const isActive = (href: string) =>
    href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);

  // Filter pages (click a requester/tag/service/status) carry their own
  // back-link header, so drop the top nav there to give that header room to breathe.
  const DETAIL_PREFIXES = ['/requester/', '/tag/', '/service/', '/status/'];
  const isDetail = $derived(DETAIL_PREFIXES.some((p) => page.url.pathname.startsWith(p)));

  // Back to the drawer without linking anything (banner button or Esc).
  function cancelPick() {
    const pick = $linkPick;
    if (!pick) return;
    linkPick.set(null);
    selectedTaskId.set(pick.childId);
  }

  onMount(() => {
    // Keep <html lang> in sync with the active locale for a11y / correct hyphenation.
    document.documentElement.lang = getLocale();
    connectWs();
    initConfig();
    initTaskStream();
    ensureNotificationPermission();
    window.addEventListener('click', copyCodeOnClick, true);
    return () => window.removeEventListener('click', copyCodeOnClick, true);
  });
</script>

<!-- preventDefault marks the Esc as consumed: the drawer's own window handler (which
     would otherwise see the just-reopened task and close it again) skips it. -->
<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && $linkPick) { e.preventDefault(); cancelPick(); } }} />

<div class="app">
  <Sidebar />
  <main>
    {#if !isDetail}
      <header class="topbar glass">
        <nav>
          {#each NAV as n}
            <a href={n.href} class:active={isActive(n.href)}>
              <Icon name={n.icon} size={14} /><span>{n.label()}</span>
            </a>
          {/each}
        </nav>
        <QuickAdd />
        {#if isActive('/')}
          <div class="agenda-tools">
            <button class="peek-toggle" class:active={$peekMode} onclick={() => peekMode.update((v) => !v)}
              title={m.view_peek()} aria-label={m.view_peek()} aria-pressed={$peekMode}><Icon name="eye" size={15} /></button>
            <div class="view-toggle" role="group" aria-label={m.view_compact()}>
              <button class:active={$viewMode === 'compact'} onclick={() => viewMode.set('compact')}
                title={m.view_compact()} aria-label={m.view_compact()} aria-pressed={$viewMode === 'compact'}><Icon name="grid" size={15} /></button>
              <button class:active={$viewMode === 'sections'} onclick={() => viewMode.set('sections')}
                title={m.view_sections()} aria-label={m.view_sections()} aria-pressed={$viewMode === 'sections'}><Icon name="rows" size={15} /></button>
            </div>
          </div>
        {/if}
      </header>
    {/if}
    {@render children()}
  </main>
  <AddIssueModal />
  <FlyingCard />
  <TaskDetail />
  {#if $linkPick}
    <div class="pick-bar glass" role="status">
      <Icon name="lock" size={14} /><span>{m.pick_banner({ title: $linkPick.title })}</span>
      <button onclick={cancelPick}>{m.common_cancel()}</button>
    </div>
  {/if}
  {#if $notice}
    <div class="notice glass" role="status">
      <Icon name="info" size={14} /><span>{$notice}</span>
      <button onclick={() => notice.set(null)} aria-label={m.td_close()}><Icon name="close" size={14} /></button>
    </div>
  {/if}
</div>

<style>
  .app { display: grid; grid-template-columns: var(--sidebar-width) 1fr; height: 100vh; }
  main { display: flex; flex-direction: column; padding: 16px; gap: 16px; overflow: hidden; }
  .topbar { display: flex; align-items: center; gap: 16px; padding: 10px 14px; }
  .topbar nav { display: flex; gap: 4px; }
  .topbar nav a {
    display: inline-flex; align-items: center; gap: 5px;
    color: var(--text-secondary); text-decoration: none; padding: 5px 10px; border-radius: 6px;
    font-size: 13px; border: 1px solid transparent;
  }
  .topbar nav a:hover { background: var(--bg-glass-hover); color: var(--text-primary); }
  .topbar nav a.active { background: var(--accent-dim); color: var(--accent); border-color: var(--accent-border); }
  /* Agenda controls, pinned to the far right of the top bar. */
  .agenda-tools { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
  .view-toggle { display: inline-flex; gap: 2px; padding: 2px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 8px; }
  .view-toggle button { display: inline-flex; align-items: center; justify-content: center; padding: 5px 9px; background: transparent; border: none; border-radius: 6px; color: var(--text-muted); cursor: pointer; }
  .view-toggle button:hover { color: var(--text-secondary); }
  .view-toggle button.active { background: var(--accent-dim); color: var(--accent); }
  /* Standalone on/off toggle for the hover-to-expand (peek) card mode. */
  .peek-toggle { display: inline-flex; align-items: center; justify-content: center; padding: 6px 9px; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 8px; color: var(--text-muted); cursor: pointer; }
  .peek-toggle:hover { color: var(--text-secondary); }
  .peek-toggle.active { background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent); }
  /* Pick-from-agenda banner, same slot as the notice (which only shows once picking is over). */
  .pick-bar { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 60; display: inline-flex; align-items: center; gap: 10px; padding: 8px 14px; font-size: 13px; color: var(--amber); border-color: var(--amber-border); }
  .pick-bar span { color: var(--text-primary); }
  .pick-bar button { padding: 3px 10px; border-radius: 5px; border: 1px solid var(--border-glass); background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
  .pick-bar button:hover { color: var(--text-primary); background: var(--bg-glass-hover); }
  /* Transient one-liner (e.g. dead deep link), above the drawer so it survives its closing. */
  .notice { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 60; display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 13px; color: var(--text-primary); }
  .notice button { display: inline-flex; align-items: center; background: transparent; border: none; color: var(--text-muted); cursor: pointer; line-height: 1; padding: 2px; }
  .notice button:hover { color: var(--text-primary); }
  /* Phones: one column, agenda first, sidebar (filters, settings) below it. */
  @media (max-width: 760px) {
    .app { grid-template-columns: 1fr; height: auto; min-height: 100vh; }
    .app > :global(aside) { order: 2; border-right: none; border-top: 1px solid var(--border-glass); overflow: visible; }
    main { order: 1; overflow: visible; padding: 12px; min-width: 0; }
    .topbar { flex-wrap: wrap; gap: 8px; }
    .topbar nav { overflow-x: auto; max-width: 100%; }
  }
</style>
