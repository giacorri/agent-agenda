<script lang="ts">
  // One icon per task status, shared by every place that shows a status.
  // In progress is a spinning arc rather than a static glyph.
  import Icon from './Icon.svelte';

  let { status, size = 14 }: { status: string; size?: number } = $props();

  const ICON: Record<string, string> = {
    pending: 'dot', snoozed: 'clock', done: 'check', shelved: 'package',
  };
</script>

{#if status === 'in_progress'}
  <svg class="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" opacity="0.25" />
    <path d="M12 3.5a8.5 8.5 0 018.5 8.5" />
  </svg>
{:else}
  <Icon name={ICON[status] ?? 'dot'} {size} />
{/if}

<style>
  .spin { animation: spin 0.9s linear infinite; flex: 0 0 auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2.5s; } }
</style>
