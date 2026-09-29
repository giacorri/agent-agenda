<script lang="ts">
  import Icon from './Icon.svelte';

  // A scope's glyph is a free string: a path/URL renders as a (rounded) image,
  // anything else is an Icon-set name, empty falls back to a neutral default.
  let { icon = '', size = 16, alt = '' }: { icon?: string; size?: number; alt?: string } = $props();
  const isImage = $derived(/^(https?:\/\/|\/)/.test(icon ?? ''));
</script>

{#if icon && isImage}
  <img class="scope-img" src={icon} {alt} style={`width:${size}px;height:${size}px`} />
{:else if icon}
  <Icon name={icon} {size} />
{:else}
  <Icon name="eye" {size} />
{/if}

<style>
  .scope-img { border-radius: 50%; object-fit: cover; flex: 0 0 auto; vertical-align: -0.15em; }
</style>
