<script lang="ts">
  import Icon from './Icon.svelte';

  // A client's logo is a free string: a path/URL/data: URL renders as an image,
  // anything else (empty) falls back to the neutral building glyph. Square with a
  // soft radius, not a circle — a company mark is rarely a face.
  let { logo = '', size = 16, alt = '' }: { logo?: string; size?: number; alt?: string } = $props();
  const isImage = $derived(/^(https?:\/\/|\/|data:)/.test(logo ?? ''));
</script>

{#if logo && isImage}
  <img class="logo" src={logo} {alt} style={`width:${size}px;height:${size}px`} />
{:else}
  <Icon name="building" {size} />
{/if}

<style>
  .logo { border-radius: 22%; object-fit: cover; background: #fff; flex: 0 0 auto; vertical-align: -0.15em; }
</style>
