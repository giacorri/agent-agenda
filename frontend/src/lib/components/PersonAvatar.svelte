<script lang="ts">
  import Icon from './Icon.svelte';

  // A person's photo is a free string: a path/URL/data: URL renders as a rounded
  // image, anything else (empty) falls back to the neutral user glyph.
  let { photo = '', size = 16, alt = '' }: { photo?: string; size?: number; alt?: string } = $props();
  const isImage = $derived(/^(https?:\/\/|\/|data:)/.test(photo ?? ''));
</script>

{#if photo && isImage}
  <img class="avatar" src={photo} {alt} style={`width:${size}px;height:${size}px`} />
{:else}
  <Icon name="user" {size} />
{/if}

<style>
  .avatar { border-radius: 50%; object-fit: cover; flex: 0 0 auto; vertical-align: -0.15em; }
</style>
