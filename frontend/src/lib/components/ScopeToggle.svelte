<script lang="ts">
  import { scope, scopeOptions, ALL } from '$lib/stores/scope';
  import Icon from './Icon.svelte';
  import ScopeIcon from './ScopeIcon.svelte';
  import * as m from '$lib/paraglide/messages';
</script>

{#if $scopeOptions.length}
  <div class="scope" role="group" aria-label={m.scope_aria()}>
    {#each $scopeOptions as o}
      <button
        class="seg"
        class:on={$scope === o.key}
        onclick={() => scope.set(o.key)}
        title={o.label}
        aria-pressed={$scope === o.key}
      >
        {#if o.key === ALL}
          <Icon name="layers" size={16} />
        {:else}
          <ScopeIcon icon={o.icon} size={16} />
        {/if}
        <span class="lbl">{o.label}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .scope { display: flex; flex: 0 0 auto; border: 1px solid var(--border-glass); border-radius: 8px; overflow: hidden; background: var(--bg-glass); }
  .seg {
    flex: 1; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
    background: transparent; border: none; color: var(--text-muted); cursor: pointer;
    padding: 6px 4px; font-size: 10px; font-family: inherit; min-width: 0;
  }
  .seg + .seg { border-left: 1px solid var(--border-glass); }
  .seg .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .seg:hover { background: var(--bg-glass-hover); color: var(--text-secondary); }
  .seg.on { background: var(--accent-dim); color: var(--accent); }
</style>
