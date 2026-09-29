<script lang="ts">
  // Deep link: /task/<id> is the agenda with that task's drawer already open. The
  // drawer fetches the task on its own (GET /api/tasks/:id), so this works before
  // the feed has loaded and for done / shelved tasks the feed may not carry; an
  // unknown id drops back to the agenda with a notice (handled by the drawer).
  import { page } from '$app/state';
  import { selectedTaskId } from '$lib/stores/tasks';
  import AgendaView from '$lib/components/AgendaView.svelte';

  $effect(() => {
    const id = page.params.id;
    if (id) selectedTaskId.set(id);
  });
</script>

<AgendaView />
