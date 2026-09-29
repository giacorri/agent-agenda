<script lang="ts">
  // Custom inline-SVG icon set — no emoji anywhere in the UI.
  // 24x24 viewBox, stroke-based, inherits currentColor so it themes with text.
  let { name, size = 16, fill = false }: { name: string; size?: number; fill?: boolean } = $props();

  const P: Record<string, string> = {
    // services
    shield: '<path d="M12 3l7 3v5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6l7-3z"/>',
    package: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19"/>',
    document: '<path d="M14 3H6v18h12V7l-4-4z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
    bot: '<rect x="4" y="8" width="16" height="11" rx="2"/><path d="M12 8V4M9 4h6"/><circle cx="9.5" cy="13.5" r="1"/><circle cx="14.5" cy="13.5" r="1"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    layers: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 17l9 5 9-5"/>',
    monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    dot: '<circle cx="12" cy="12" r="4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/>',
    // actions / status
    check: '<path d="M5 12l5 5L20 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sunrise: '<circle cx="12" cy="14" r="3"/><path d="M12 4v3M4.5 14H2.5M21.5 14h-2M5.6 7.6L4.2 6.2M18.4 7.6l1.4-1.4M2 20h20"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0115 0"/>',
    expand: '<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/>',
    note: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    pencil: '<path d="M4 20h4L18.5 9.5a2 2 0 00-2.8-2.8L5 17v3z"/><path d="M13.5 6.5l4 4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    arrow: '<path d="M12 20V5M6 11l6-6 6 6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    rows: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/>',
    link: '<path d="M9 15l6-6M8 11l-2 2a3.5 3.5 0 005 5l2-2M16 13l2-2a3.5 3.5 0 00-5-5l-2 2"/>',
    file: '<path d="M14 3H6v18h12V7l-4-4z"/><path d="M14 3v4h4"/>',
    download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/>',
    // more services
    bell: '<path d="M6 9a6 6 0 1112 0c0 5 2 7 2 7H4s2-2 2-7z"/><path d="M10 20a2 2 0 004 0"/>',
    alarm: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M5 3L2 6M19 3l3 3"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    spark: '<path d="M12 3l1.8 4.5L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.5L12 3z"/><path d="M18 15l.8 2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-1z"/>',
    // tags
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
    key: '<circle cx="8.5" cy="8.5" r="4.5"/><path d="M12 12l8 8M17 17l3-3"/>',
    rocket: '<path d="M14 4c3 0 6 1 6 1s1 3 1 6c0 4-3 7-6 8l-3-3-2-2-3-3c1-3 4-6 8-7z"/><path d="M5 15c-1 1-1 4-1 4s3 0 4-1M14 9h.01"/>',
    book: '<path d="M5 4a2 2 0 012-2h12v18H7a2 2 0 00-2 2V4z"/><path d="M7 16h12"/>',
    cloud: '<path d="M7 18a4 4 0 010-8 5 5 0 019.5-1.5A4 4 0 0117 18H7z"/>',
    music: '<circle cx="6" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/><path d="M8.5 18V7l11-2v11"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    wrench: '<path d="M15 4a4 4 0 00-5.2 5.2l-6 6a2 2 0 102.8 2.8l6-6A4 4 0 0020 7l-3 3-2.5-.5L14 7l1-3z"/>',
    chart: '<path d="M4 4v16h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    alert: '<path d="M12 3l9 16H3L12 3z"/><path d="M12 10v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    tag: '<path d="M20.5 13.4L13 20.9l-9-9V4h7.9l8.6 8.6a1.2 1.2 0 010 1.8z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
    beaker: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 001.8 3h10.4A2 2 0 0019 18l-5-9V3"/><path d="M7.5 14h9"/>',
    bug: '<rect x="8" y="8" width="8" height="11" rx="4"/><path d="M12 8V5M9 6L8 4M15 6l1-2M8 12H4M20 12h-4M8 16H5M19 16h-3"/>',
    userplus: '<circle cx="9" cy="8" r="4"/><path d="M2.5 21a6.5 6.5 0 0113 0M18 8v6M21 11h-6"/>',
    play: '<path d="M7 4l13 8-13 8V4z"/>',
    tuner: '<path d="M9 3v6a3 3 0 006 0V3"/><path d="M12 15v6M9 21h6"/>',
    headphones: '<path d="M4 14a8 8 0 0116 0"/><rect x="3" y="14" width="4.5" height="6" rx="1.6"/><rect x="16.5" y="14" width="4.5" height="6" rx="1.6"/>',
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
    building: '<path d="M4 21V5a2 2 0 012-2h7a2 2 0 012 2v16"/><path d="M15 9h3a2 2 0 012 2v10M2 21h20"/><path d="M7.5 7h.01M11 7h.01M7.5 11h.01M11 11h.01M7.5 15h.01M11 15h.01M18 14h.01M18 17.5h.01"/>',
    mushroom: '<path d="M4 12C4 6.8 7.6 4 12 4s8 2.8 8 8z"/><path d="M9.3 12v4.6c0 2.2 5.4 2.2 5.4 0V12"/><circle cx="9.6" cy="8.6" r=".55"/><circle cx="14" cy="7.7" r=".55"/>',
  };
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={fill ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {@html P[name] ?? P.dot}
</svg>

<style>
  .icon { display: inline-block; vertical-align: -0.15em; flex: 0 0 auto; }
</style>
