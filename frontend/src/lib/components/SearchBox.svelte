<script lang="ts">
  import { page } from '$app/state';
  import { query, searchActive, globalMatches, focusRequest } from '$lib/stores/search';
  import { addOpen } from '$lib/stores/view';
  import { selectedTaskId } from '$lib/stores/tasks';
  import Icon from './Icon.svelte';
  import * as m from '$lib/paraglide/messages';

  let input = $state<HTMLInputElement>();

  const onAgenda = $derived(page.url.pathname === '/');

  function focus() {
    input?.focus();
    input?.select();
  }
  // Another screen asked for the box (pick-from-agenda mode); 0 is the untouched state.
  $effect(() => { if ($focusRequest) focus(); });

  // "/" and ⌘K / Ctrl+K reach the box from any screen. "/" is ignored while typing in
  // another field so the shortcut never swallows a character; both are off while the
  // add modal or the task drawer is up, where focus belongs to the overlay.
  function onWindowKey(e: KeyboardEvent) {
    if ($addOpen || $selectedTaskId) return;
    const el = e.target as HTMLElement | null;
    const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    const cmdK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
    const slash = e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (cmdK || slash) {
      e.preventDefault();
      focus();
    }
  }

  // Esc clears, then (on an already-empty box) gives the focus back. Stops here so it
  // doesn't also close the task drawer listening on window.
  function onInputKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if ($query) query.set('');
    else input?.blur();
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="search">
  <div class="field" class:on={$searchActive}>
    <Icon name="search" size={14} />
    <input
      bind:this={input}
      type="search"
      value={$query}
      oninput={(e) => query.set(e.currentTarget.value)}
      onkeydown={onInputKey}
      placeholder={m.search_placeholder()}
      aria-label={m.search_aria()}
      autocomplete="off"
      spellcheck="false"
    />
    {#if $searchActive}
      <button class="clear" onclick={() => { query.set(''); focus(); }} title={m.search_clear()} aria-label={m.search_clear()}>
        <Icon name="close" size={12} />
      </button>
    {:else}
      <kbd>/</kbd>
    {/if}
  </div>
  <!-- Only off the main agenda, where the view can hide matches that exist elsewhere:
       the count is both the tell and the way out, carrying the query to the full list.
       On the agenda itself the result header already says it. -->
  {#if $searchActive && !onAgenda}
    <a class="hits" href="/">{m.search_all_agenda({ n: $globalMatches })}</a>
  {/if}
</div>

<style>
  .search { display: flex; flex-direction: column; gap: 4px; }
  .field {
    display: flex; align-items: center; gap: 7px; padding: 5px 8px;
    background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: 8px;
    color: var(--text-muted);
  }
  .field:focus-within { border-color: var(--accent-border); color: var(--accent); }
  .field.on { border-color: var(--accent-border); color: var(--accent); }
  .field input {
    flex: 1; min-width: 0; background: none; border: none; outline: none;
    font: inherit; font-size: 12.5px; color: var(--text-primary);
  }
  .field input::placeholder { color: var(--text-muted); }
  /* Kill the WebKit clear glyph: the styled button below is the only affordance. */
  .field input::-webkit-search-cancel-button { display: none; }
  .clear {
    display: inline-flex; align-items: center; justify-content: center;
    background: none; border: none; padding: 2px; border-radius: 4px;
    color: var(--text-muted); cursor: pointer;
  }
  .clear:hover { color: var(--text-primary); background: var(--bg-glass-hover); }
  kbd {
    font: inherit; font-size: 10px; line-height: 1; padding: 2px 5px; border-radius: 4px;
    color: var(--text-muted); background: var(--bg-glass-hover); border: 1px solid var(--border-glass);
  }
  .hits { font-size: 11px; padding-left: 2px; text-decoration: none; color: var(--link); }
  .hits:hover { color: var(--link-hover); }
</style>
