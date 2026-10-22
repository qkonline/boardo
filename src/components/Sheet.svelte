<script lang="ts">
  import { onMount, setContext, type Snippet } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { fade } from 'svelte/transition';
  
  import { desktop, reducedMotion } from '../lib/ui.svelte';

  /**
   * full: bottom sheet (88%) on phone, 440px right side panel on desktop.
   * form: bottom sheet sized to content on phone, centred 480px dialog on desktop.
   * small: centred 360px dialog everywhere.
   * side: a panel in from the right everywhere, over the page; on a phone a strip of the page
   *   stays in view beside it, so a tap outside closes it there too.
   * A form whose fields come and go as choices change (New habit) can ask for a fixed height
   * through the 'sheet' context, so the sheet doesn't jump with them.
   */
  let {
    variant,
    label,
    onclose,
    children,
  }: { variant: 'full' | 'form' | 'small' | 'side'; label: string; onclose: () => void; children: Snippet } = $props();

  let tall = $state(false);
  setContext('sheet', {
    set tall(v: boolean) {
      tall = v;
    },
  });

  let panel: HTMLDivElement | null = $state(null);
  const shape = $derived(
    variant === 'side'
      ? 'side'
      : variant === 'small'
        ? 'dialog small'
      : desktop.current
        ? variant === 'form'
          ? tall
            ? 'dialog tall'
            : 'dialog'
          : 'side'
        : variant === 'form' && !tall
          ? 'bottom'
          : 'bottom tall',
  );

  // Bottom sheets slide up from the bottom of the screen, the side panel in from the right, and
  // dialogs fade and grow slightly. Leaving plays the same motion backwards (an ease-out curve
  // played in reverse speeds up as it goes, which suits things leaving the screen).
  const IN_MS = 300;
  const OUT_MS = 220;
  function motion(node: Element, { leaving = false } = {}) {
    const duration = reducedMotion.current ? 0 : leaving ? OUT_MS : IN_MS;
    const bottom = node.classList.contains('bottom');
    const side = node.classList.contains('side');
    // Closed by a swipe: carry on down from where the finger let go.
    const from = leaving ? dragY : 0;
    return {
      duration,
      easing: cubicOut,
      css: (t: number) =>
        bottom
          ? `transform: translateY(calc(${1 - t} * (100% - ${from}px) + ${from}px))`
          : side
            ? `transform: translateX(${(1 - t) * 100}%)`
            : `opacity: ${t}; transform: translate(-50%, -50%) scale(${0.96 + 0.04 * t})`,
    };
  }
  const scrimFade = (node: Element, { leaving = false } = {}) =>
    fade(node, { duration: reducedMotion.current ? 0 : leaving ? OUT_MS : IN_MS });

  // Swipe down to close (phone bottom sheets). The sheet follows the finger; past a quarter of
  // its height, or on a quick flick, it closes, otherwise it springs back. When its content is
  // scrolled down, dragging scrolls it first; drags that start in a field are left alone.
  let dragY = $state(0);
  let dragging = $state(false);
  const isBottom = $derived(shape.startsWith('bottom'));

  function swipeToClose(el: HTMLElement) {
    let x0 = 0,
      y0 = 0,
      t0 = 0,
      mode: 'drag' | 'ignore' | null = null;
    const scrolled = (from: Element | null) => {
      for (let n = from; n && n !== el; n = n.parentElement) if (n.scrollTop > 0) return true;
      return false;
    };
    const start = (e: TouchEvent) => {
      mode = null;
      if (!isBottom || e.touches.length !== 1) return void (mode = 'ignore');
      const target = e.target as Element;
      if (target.closest('input, textarea, select') || scrolled(target)) return void (mode = 'ignore');
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
    };
    const move = (e: TouchEvent) => {
      if (mode === 'ignore') return;
      const dy = e.touches[0].clientY - y0,
        dx = e.touches[0].clientX - x0;
      if (!mode) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        mode = dy > 0 && dy > Math.abs(dx) ? 'drag' : 'ignore';
        if (mode === 'ignore') return;
        dragging = true;
      }
      if (e.cancelable) e.preventDefault();
      dragY = Math.max(0, dy);
    };
    const end = () => {
      if (mode !== 'drag') return void (mode = null);
      mode = null;
      dragging = false;
      const flick = dragY > 40 && Date.now() - t0 < 250;
      if (dragY > el.offsetHeight * 0.25 || flick) onclose();
      else dragY = 0;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }

  // Move focus into the sheet when it opens and hand it back to whatever opened it on close.
  onMount(() => {
    const prev = document.activeElement as HTMLElement | null;
    const auto = panel?.querySelector<HTMLElement>('[data-autofocus]');
    (auto ?? panel)?.focus({ preventScroll: true });
    return () => {
      if (prev?.isConnected) prev.focus({ preventScroll: true });
    };
  });

  // Keep Tab inside the sheet.
  function trap(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      return onclose();
    }
    if (e.key !== 'Tab' || !panel) return;
    const f = [
      ...panel.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])'),
    ].filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0],
      last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<div
  class="scrim"
  onclick={() => onclose()}
  aria-hidden="true"
  style:opacity={dragY && panel ? Math.max(0, 1 - dragY / panel.offsetHeight) : undefined}
  in:scrimFade|global
  out:scrimFade|global={{ leaving: true }}
></div>
<div
  class="panel {shape}"
  role="dialog"
  aria-modal="true"
  aria-label={label}
  tabindex="-1"
  bind:this={panel}
  onkeydown={trap}
  class:settling={!dragging}
  style:transform={dragY ? `translateY(${dragY}px)` : undefined}
  {@attach swipeToClose}
  in:motion|global
  out:motion|global={{ leaving: true }}
>
  {#if !desktop.current && variant !== 'small' && variant !== 'side'}
    <div class="handle"><span></span></div>
  {/if}
  {@render children()}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: 6;
  }
  .panel {
    position: fixed;
    z-index: 7;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
  }
  /* Sit on top of the on-screen keyboard and never be taller than what's still visible. The
     first shadow fills the space under the sheet down to the keyboard with the sheet's colour
     (listed first so it covers the drop shadow there): iOS's see-through bar above the keyboard
     (arrows and ✓) sits there, and the page behind would otherwise show around it. */
  .bottom {
    left: 0;
    right: 0;
    bottom: var(--kb, 0px);
    max-height: min(88dvh, calc(var(--vvh, 100dvh) - 12px));
    border-radius: 12px 12px 0 0;
    box-shadow:
      0 var(--kb, 0px) 0 var(--bg),
      0 -10px 40px rgba(0, 0, 0, 0.2);
  }
  .bottom.settling {
    transition: transform 220ms ease;
  }
  .bottom.tall {
    height: min(88dvh, calc(var(--vvh, 100dvh) - 12px));
  }
  .dialog {
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(480px, calc(100% - 32px));
    max-height: calc(100dvh - 64px);
    border-radius: 12px;
    border: 1px solid var(--border);
    box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.35);
  }
  .dialog.tall {
    height: min(760px, calc(100dvh - 64px));
  }
  .dialog.small {
    width: min(360px, calc(100% - 32px));
  }
  .side {
    top: 0;
    right: 0;
    bottom: 0;
    width: min(440px, calc(100% - 48px));
    padding-top: env(safe-area-inset-top);
    border-left: 1px solid var(--border);
    box-shadow: -16px 0 48px rgba(0, 0, 0, 0.16);
  }
  .handle {
    display: flex;
    justify-content: center;
    padding: 8px 0 0;
    flex: none;
  }
  .handle span {
    width: 40px;
    height: 5px;
    border-radius: var(--r-sm);
    background: var(--line);
  }
</style>
