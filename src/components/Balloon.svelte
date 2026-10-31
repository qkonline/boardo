<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A small floating balloon beside the control that opened it (status, column, people, emoji).
   * It sits over the page, so nothing moves when it opens. Closes on Escape or a tap outside.
   * It opens to the side asked for, then slides along as far as it must to stay inside the
   * window it's in (or the screen), its point still on the control, so it never makes the
   * window scroll sideways.
   */
  let {
    open = $bindable(false),
    label,
    place = 'below',
    align = 'start',
    onclose,
    trigger,
    children,
  }: {
    open?: boolean;
    label: string;
    place?: 'below' | 'above';
    align?: 'start' | 'end';
    onclose?: () => void;
    trigger: Snippet<[{ toggle: () => void; open: boolean }]>;
    children: Snippet<[() => void]>;
  } = $props();

  let root: HTMLElement | null = $state(null);
  let box: HTMLElement | null = $state(null);
  /** Where it sits from the control's left edge, and where its point goes, once measured. */
  let shift = $state<{ x: number; point: number } | null>(null);
  const close = () => (open = false);
  const FOCUSABLE = 'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])';
  // Tell the owner when it closes, however it closed. Used by keyboard, the focus that was in it
  // (and went with it) goes back to the control that opened it. Used by pointer, focus is left as
  // it was, so Enter in the card window still saves after a pick with the mouse.
  let was = false;
  let keyed = false;
  $effect(() => {
    if (was && !open) {
      onclose?.();
      const at = document.activeElement;
      if (keyed && (!at || at === document.body)) root?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
    }
    was = open;
  });
  // Opened from a control reached by keyboard: focus moves in, onto the value already chosen,
  // unless something in it took focus itself.
  $effect(() => {
    if (!open || !box || !root) return;
    const at = document.activeElement;
    keyed = !!at?.matches(':focus-visible');
    if (!keyed || !root.contains(at) || box.contains(at)) return;
    const chosen = box.querySelector<HTMLElement>('[aria-selected=true], [aria-checked=true], [aria-pressed=true]');
    (chosen ?? box.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
  });
  const toggle = () => (open = !open);

  /** The nearest box that clips or scrolls the balloon, or the screen. */
  function bounds(el: HTMLElement): { left: number; right: number } {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflowX !== 'visible' || o.overflowY !== 'visible') {
        const r = p.getBoundingClientRect();
        return { left: r.left, right: r.left + p.clientWidth };
      }
    }
    return { left: 0, right: document.documentElement.clientWidth };
  }

  $effect(() => {
    if (!open || !box || !root) return;
    const room = bounds(root);
    const w = box.getBoundingClientRect().width;
    const a = root.getBoundingClientRect();
    const GAP = 8;
    const want = align === 'start' ? a.left : a.right - w;
    const x = Math.max(room.left + GAP, Math.min(want, room.right - GAP - w));
    const point = Math.max(10, Math.min(a.left + Math.min(a.width / 2, 22) - x - 5, w - 22));
    shift = x === want ? null : { x: x - a.left, point };
  });
  $effect(() => {
    if (!open) shift = null;
  });

  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      keyed = false;
      if (root && !root.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      keyed = true;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    // Next tick, so the tap that opened it doesn't close it again.
    const t = setTimeout(() => document.addEventListener('pointerdown', away, true));
    document.addEventListener('keydown', key, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
    };
  });
</script>

<span class="anchor" bind:this={root}>
  {@render trigger({ toggle, open })}
  {#if open}
    <div
      class="balloon {place} {align}"
      class:shifted={shift}
      style:--x={shift ? `${shift.x}px` : null}
      style:--point={shift ? `${shift.point}px` : null}
      role="dialog"
      aria-label={label}
      bind:this={box}
    >
      {@render children(close)}
    </div>
  {/if}
</span>

<style>
  .anchor {
    position: relative;
    display: inline-flex;
  }
  .balloon {
    position: absolute;
    z-index: 20;
    min-width: 168px;
    max-width: min(320px, 86vw);
    padding: 6px;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: var(--r-card);
    box-shadow:
      0 14px 34px -10px rgba(0, 0, 0, 0.3),
      0 2px 0 var(--line);
    animation: pop 140ms ease-out;
  }
  .below {
    top: calc(100% + 8px);
  }
  .above {
    bottom: calc(100% + 8px);
  }
  .start {
    left: 0;
  }
  .end {
    right: 0;
  }
  /* The little point toward the control. */
  .balloon::before {
    content: '';
    position: absolute;
    width: 10px;
    height: 10px;
    background: var(--raised);
    border: 1px solid var(--line);
    rotate: 45deg;
  }
  .below::before {
    top: -6px;
    border-right: none;
    border-bottom: none;
  }
  .above::before {
    bottom: -6px;
    border-left: none;
    border-top: none;
  }
  .start::before {
    left: 16px;
  }
  .end::before {
    right: 16px;
  }
  /* Slid along to stay inside the window: placed from the control's left edge, point kept on it. */
  .shifted {
    left: var(--x);
    right: auto;
  }
  .shifted::before {
    left: var(--point);
    right: auto;
  }
  @keyframes pop {
    from {
      opacity: 0;
      translate: 0 -4px;
    }
  }
  .above {
    animation-name: pop-up;
  }
  @keyframes pop-up {
    from {
      opacity: 0;
      translate: 0 4px;
    }
  }
</style>
