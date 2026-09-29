<script lang="ts">
  import { addOpen } from '$lib/stores/view';
  import * as m from '$lib/paraglide/messages';
  import Icon from './Icon.svelte';
</script>

<button class="add-btn" onclick={() => addOpen.set(true)} aria-label={m.qa_new()}>
  <Icon name="plus" size={16} /><span>{m.qa_add()}</span>
</button>

<style>
  .add-btn {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--accent-dim); border: 1px solid var(--accent-border); color: var(--accent);
    padding: 7px 14px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600;
  }
  .add-btn:hover { background: var(--accent); color: var(--bg-dark, #0f0f1a); }
</style>
