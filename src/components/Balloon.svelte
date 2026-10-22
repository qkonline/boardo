<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A small floating balloon beside the control that opened it (status, column, people, emoji).
   * It sits over the page, so nothing moves when it opens. Closes on Escape or a tap outside.
   */
  let {
    open = $bindable(false),
    label,
    place = 'below',
    align = 'start',
    trigger,
    children,
  }: {
    open?: boolean;
    label: string;
    place?: 'below' | 'above';
    align?: 'start' | 'end';
    trigger: Snippet<[{ toggle: () => void; open: boolean }]>;
    children: Snippet<[() => void]>;
  } = $props();

  let root: HTMLElement | null = $state(null);
  const close = () => (open = false);
  const toggle = () => (open = !open);

  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
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
    <div class="balloon {place} {align}" role="dialog" aria-label={label}>
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
    min-width: 220px;
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
