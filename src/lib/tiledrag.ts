// Dragging things in a list or grid into a new order: the boards on Boards (each person's own
// order, R2.5a) and a board's fields (by their handle). As with cards (drag.svelte.ts): with a mouse
// an item lifts once it has moved a few pixels; on a touch screen after pressing and holding it, so
// a swipe still scrolls. A floating copy follows the pointer while the others move aside to show
// where it will land; Escape puts it back. A tap is still a tap.

const HOLD_MS = 320;
const MOVE_PX = 6;
const SLOP_PX = 10;
const EDGE_PX = 56;

export interface TileDragOptions {
  /** What's dragged: the items with `data-<attr>` holding their id ('board' by default). */
  attr?: string;
  /** Only a press inside this (a grip) starts a drag. */
  handle?: string;
  /** The ids in their order now. */
  ids: () => string[];
  /** The order to show while dragging (null: back to the real one). */
  preview: (ids: string[] | null, id?: string) => void;
  /** Dropped somewhere new: the new order, and which one moved. */
  drop: (ids: string[], id: string) => void;
}

let active = false;
// A touch drag mustn't scroll the page; this has to be a non-passive listener from the start.
if (typeof document !== 'undefined')
  document.addEventListener(
    'touchmove',
    (e) => {
      if (active && e.cancelable) e.preventDefault();
    },
    { passive: false },
  );

/** Make the `[data-<attr>]` items inside `root` draggable. Returns the clean-up. */
export function tileDrag(root: HTMLElement, o: TileDragOptions): () => void {
  const attr = o.attr ?? 'board';
  const sel = `[data-${attr}]`;
  /** A drag just ended: the click that follows it mustn't open the board. */
  let justDropped = false;

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (o.handle && !(e.target as Element).closest(o.handle)) return;
    const el = (e.target as Element).closest<HTMLElement>(sel);
    if (!el) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const touch = e.pointerType !== 'mouse';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', cleanup);
      removeEventListener('pointercancel', cleanup);
    };
    const start = () => {
      cleanup();
      lift(el, x0, y0, touch);
      navigator.vibrate?.(10);
    };
    const move = (m: PointerEvent) => {
      const far = Math.hypot(m.clientX - x0, m.clientY - y0);
      if (touch) {
        if (far > SLOP_PX) cleanup(); // a scroll, not a hold
      } else if (far > MOVE_PX) start();
    };
    if (touch) timer = setTimeout(start, HOLD_MS);
    addEventListener('pointermove', move);
    addEventListener('pointerup', cleanup);
    addEventListener('pointercancel', cleanup);
  };

  function lift(el: HTMLElement, x: number, y: number, touch: boolean) {
    const id = el.dataset[attr]!;
    const start = o.ids();
    let order = start;
    let point = { x, y };
    const r = el.getBoundingClientRect();
    const offset = { x: x - r.left, y: y - r.top };
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.removeAttribute(`data-${attr}`);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      margin: '0',
      zIndex: '50',
      pointerEvents: 'none',
      rotate: '2deg',
      boxShadow: '0 14px 30px rgba(0,0,0,.22)',
      listStyle: 'none',
    });
    document.body.appendChild(ghost);
    document.body.classList.add('dragging');
    active = true;
    o.preview(order, id);

    /** The tile under the pointer (or the nearest one) takes the dragged one's place. */
    const locate = () => {
      const tiles = [...root.querySelectorAll<HTMLElement>(sel)];
      let best: { id: string; d: number } | null = null;
      for (const t of tiles) {
        // Where the tile rests, not where it is mid-slide (a moving tile would swap straight back).
        const op = (t.offsetParent ?? document.body) as HTMLElement;
        const o = op.getBoundingClientRect();
        const cx = o.left + op.clientLeft + t.offsetLeft + t.offsetWidth / 2;
        const cy = o.top + op.clientTop + t.offsetTop + t.offsetHeight / 2;
        const d = Math.hypot(point.x - cx, point.y - cy);
        if (!best || d < best.d) best = { id: t.dataset[attr]!, d };
      }
      if (!best || best.id === id) return;
      const next = order.filter((x) => x !== id);
      next.splice(order.indexOf(best.id), 0, id);
      if (next.join() !== order.join()) {
        order = next;
        o.preview(order, id);
      }
    };
    const moveTo = (p: { clientX: number; clientY: number }) => {
      point = { x: p.clientX, y: p.clientY };
      ghost.style.left = `${p.clientX - offset.x}px`;
      ghost.style.top = `${p.clientY - offset.y}px`;
      locate();
    };
    let raf = 0;
    // Near the top or bottom of the window, the page scrolls (a phone with many boards).
    const tick = () => {
      if (point.y < EDGE_PX) scrollBy(0, -10);
      else if (point.y > innerHeight - EDGE_PX) scrollBy(0, 10);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const touchMove = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      if (e.touches[0]) moveTo(e.touches[0]);
    };
    const end = (keep: boolean) => {
      cancelAnimationFrame(raf);
      ghost.remove();
      document.body.classList.remove('dragging');
      active = false;
      removeEventListener('pointermove', moveTo);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      removeEventListener('touchmove', touchMove);
      removeEventListener('touchend', up);
      removeEventListener('touchcancel', cancel);
      removeEventListener('keydown', key);
      o.preview(null);
      justDropped = true;
      setTimeout(() => (justDropped = false), 0);
      if (keep && order.join() !== start.join()) o.drop(order, id);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && end(false);
    if (touch) {
      addEventListener('touchmove', touchMove, { passive: false });
      addEventListener('touchend', up);
      addEventListener('touchcancel', cancel);
    } else {
      addEventListener('pointermove', moveTo);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', cancel);
    }
    addEventListener('keydown', key);
  }

  // A drag ends with a click on the tile: it mustn't open the board.
  const click = (e: MouseEvent) => {
    if (justDropped) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  // No long-press menu on a tile (iOS would show one instead of letting the hold lift it).
  const menu = (e: Event) => {
    if ((e.target as Element).closest(o.handle ?? sel)) e.preventDefault();
  };
  root.addEventListener('pointerdown', down);
  root.addEventListener('click', click, true);
  root.addEventListener('contextmenu', menu);
  return () => {
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('click', click, true);
    root.removeEventListener('contextmenu', menu);
  };
}
