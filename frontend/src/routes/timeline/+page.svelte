<script lang="ts">
  import TimelineView from '$lib/components/TimelineView.svelte';
  import StudyTimeline from '$lib/components/StudyTimeline.svelte';
  import { scope, ALL } from '$lib/stores/scope';
  import { config } from '$lib/stores/config';

  // Show the per-exam study timeline when every scope in view is a study scope
  // (a single study install, or the study scope selected). Mixed/ALL with generic
  // scopes keeps the classic timeline.
  const isStudyView = $derived.by(() => {
    const scopes = $config.scopes;
    if (!scopes.length) return false;
    const inView = !$scope || $scope === ALL ? scopes : scopes.filter((s) => s.key === $scope);
    return inView.length > 0 && inView.every((s) => s.type === 'study');
  });
</script>

{#if isStudyView}
  <StudyTimeline />
{:else}
  <TimelineView />
{/if}
