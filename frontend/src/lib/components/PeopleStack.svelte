<script lang="ts">
  import { config, personFor } from '$lib/stores/config';
  import PersonAvatar from './PersonAvatar.svelte';

  // Overlapping avatars for the people tagged on a task. Each links to the person's
  // page, which lists the tasks they asked for or are tagged on.
  let { names, size = 22 }: { names: string[]; size?: number } = $props();
</script>

<span class="stack">
  {#each names as name (name)}
    {@const p = personFor(name, $config)}
    <a href={`/requester/${encodeURIComponent(p?.key ?? name)}`} title={p?.label ?? name} aria-label={p?.label ?? name}
      onclick={(e) => e.stopPropagation()}><PersonAvatar photo={p?.photo} {size} alt={p?.label ?? name} /></a>
  {/each}
</span>

<style>
  .stack { display: inline-flex; align-items: center; }
  a { display: inline-flex; flex: none; border-radius: 999px; background: var(--bg-glass-hover); box-shadow: 0 0 0 1.5px var(--border-glass); text-decoration: none; color: var(--text-secondary); }
  a + a { margin-left: -6px; }
  a:hover { box-shadow: 0 0 0 2px var(--accent); position: relative; z-index: 1; }
</style>
