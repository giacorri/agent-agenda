<script lang="ts">
  import { tick } from 'svelte';
  import { flying, creatingId, formingId } from '$lib/stores/view';
  import { tasks } from '$lib/stores/tasks';
  import TaskCard from './TaskCard.svelte';

  let el = $state<HTMLElement>();

  const reduce = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Deliberately unhurried, and strictly sequential:
  const FORM_MS = 750;  // 1) the card takes shape where the modal was (list stays still)
  const HOLD_MS = 350;  // 2) a beat, so you register the finished card before it moves
  const FLY_MS = 1050;  // 3) it glides to its slot while neighbours make room (see flip)

  const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  const wait = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

  // Poll until the real card has a genuine slot — a laid-out box (width/height > 0), not
  // a display:none placeholder (which would read as 0,0 and send the ghost to the corner).
  async function waitSlot(id: string): Promise<HTMLElement | null> {
    for (let i = 0; i < 90; i++) {
      const el = document.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
      const r = el?.getBoundingClientRect();
      if (el && r && r.width > 1 && r.height > 1) return el;
      await raf();
    }
    return null;
  }

  function ensureInList(id: string, task: any) {
    tasks.update((l) => (l.some((t) => t.id === id) ? l : [...l, task]));
  }

  $effect(() => {
    const f = $flying;
    if (!f || !el) return;
    const node = el;
    let cancelled = false;

    (async () => {
      if (reduce) { formingId.set(null); creatingId.set(null); ensureInList(f.task.id, f.task); flying.set(null); return; }

      // Born centred on the modal, at final card width; height is the card's natural height.
      const h0 = node.offsetHeight;
      const bornX = f.from.x + f.from.w / 2 - f.colW / 2;
      const bornY = f.from.y + f.from.h / 2 - h0 / 2;

      // Phase 1: take shape in place — grow + fade in. formingId keeps the real card out
      // of the layout, so the list doesn't move yet.
      await node.animate(
        [
          { transform: `translate(${bornX}px, ${bornY}px) scale(0.86)`, opacity: 0 },
          { transform: `translate(${bornX}px, ${bornY}px) scale(1)`, opacity: 1 },
        ],
        { duration: FORM_MS, easing: 'cubic-bezier(0.2, 0.85, 0.25, 1)', fill: 'forwards' },
      ).finished;
      if (cancelled) return;
      await wait(HOLD_MS);
      if (cancelled) return;

      // Phase 2 begins: move the real card into the layout (hidden) → neighbours make
      // room (flip). Wait for the redraw, read its real slot, then fly there in sync.
      ensureInList(f.task.id, f.task);
      creatingId.set(f.task.id);
      formingId.set(null);
      await tick();
      const cardEl = await waitSlot(f.task.id);
      if (cancelled) return;
      if (!cardEl) { creatingId.set(null); flying.set(null); return; }
      cardEl.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
      const to = cardEl.getBoundingClientRect();

      await node.animate(
        [
          { transform: `translate(${bornX}px, ${bornY}px)`, width: `${f.colW}px`, height: `${h0}px`, opacity: 1 },
          { transform: `translate(${to.x}px, ${to.y}px)`, width: `${to.width}px`, height: `${to.height}px`, opacity: 1 },
        ],
        { duration: FLY_MS, easing: 'cubic-bezier(0.2, 0.85, 0.25, 1)', fill: 'forwards' },
      ).finished;
      if (cancelled) return;

      creatingId.set(null); // reveal the real card exactly under the landed ghost
      flying.set(null);
    })();

    return () => { cancelled = true; };
  });
</script>

{#if $flying}
  <div class="fly" bind:this={el} style="width:{$flying.colW}px; opacity:0">
    <TaskCard task={$flying.task} />
  </div>
{/if}

<style>
  /* display:grid stretches the reused TaskCard to fill the ghost box, so it looks
     exactly like the card it becomes. A solid backdrop under the card's glass makes the
     ghost fully opaque (it flies over other cards), and a strong shadow lifts it. */
  .fly { position: fixed; top: 0; left: 0; z-index: 200; pointer-events: none; display: grid;
    border-radius: 10px; background: var(--bg-dark, #0f0f1a);
    will-change: transform, width, height, opacity; filter: drop-shadow(0 28px 64px rgba(0, 0, 0, 0.72)); }
</style>
