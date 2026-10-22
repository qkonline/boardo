// Dragging cards within and between columns (R3.5). With a mouse, a card lifts once it has moved
// a few pixels; on a touch screen, after pressing and holding it, so a plain swipe still
// scrolls. The lifted card follows the pointer as a floating copy, a line shows where it will
// land, and the board scrolls when the pointer nears an edge. A tap without a drag opens it.

const HOLD_MS = 320;
const MOVE_PX = 6;
const SLOP_PX = 10;
const EDGE_PX = 56;

export interface Drop {
  column: string;
  /** Index among the column's other cards (the dragged one left out). */
  index: number;
}

class Drag {
  /** The card being dragged, and where it would land. */
  card = $state<string | null>(null);
  drop = $state<Drop | null>(null);
  /** A drag just ended: the click that follows it mustn't open the card. */
  justDropped = false;

  private ghost: HTMLElement | null = null;
  private offset = { x: 0, y: 0 };
  private point = { x: 0, y: 0 };
  private raf = 0;
  private scroller: HTMLElement | null = null;
  private onDrop: ((card: string, drop: Drop) => void) | null = null;

  constructor() {
    // A touch drag mustn't scroll the page; this has to be a non-passive listener from the start.
    if (typeof document !== 'undefined')
      document.addEventListener(
        'touchmove',
        (e) => {
          if (this.card && e.cancelable) e.preventDefault();
        },
        { passive: false },
      );
  }

  /** Make the cards inside `root` draggable. `scroller` is the sideways-scrolling row of columns. */
  attach(root: HTMLElement, scroller: () => HTMLElement | null, onDrop: (card: string, drop: Drop) => void) {
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as Element).closest<HTMLElement>('[data-card]');
      const inner = (e.target as Element).closest('button, input, textarea, select, a');
      if (!el || (inner && inner !== el)) return;
      const id = el.dataset.card!;
      const x0 = e.clientX;
      const y0 = e.clientY;
      const touch = e.pointerType !== 'mouse';
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', cancel);
      };
      const start = () => {
        cleanup();
        this.begin(el, id, x0, y0, scroller(), onDrop, touch);
        navigator.vibrate?.(10);
      };
      const move = (m: PointerEvent) => {
        const far = Math.hypot(m.clientX - x0, m.clientY - y0);
        if (touch) {
          if (far > SLOP_PX) cleanup(); // a scroll, not a hold
        } else if (far > MOVE_PX) start();
      };
      const up = () => cleanup();
      const cancel = () => cleanup();
      if (touch) timer = setTimeout(start, HOLD_MS);
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', cancel);
    };
    // No long-press menu on the cards (iOS would show one instead of letting the hold lift it).
    const menu = (e: Event) => {
      if ((e.target as Element).closest('[data-card]')) e.preventDefault();
    };
    root.addEventListener('pointerdown', down);
    root.addEventListener('contextmenu', menu);
    return () => {
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('contextmenu', menu);
    };
  }

  private begin(
    el: HTMLElement,
    id: string,
    x: number,
    y: number,
    scroller: HTMLElement | null,
    onDrop: (card: string, drop: Drop) => void,
    touch: boolean,
  ) {
    const r = el.getBoundingClientRect();
    const g = el.cloneNode(true) as HTMLElement;
    g.classList.add('drag-ghost');
    Object.assign(g.style, {
      position: 'fixed',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      zIndex: '50',
      pointerEvents: 'none',
      rotate: '2deg',
      boxShadow: '0 14px 30px rgba(0,0,0,.22)',
    });
    document.body.appendChild(g);
    this.ghost = g;
    this.offset = { x: x - r.left, y: y - r.top };
    this.point = { x, y };
    this.scroller = scroller;
    this.onDrop = onDrop;
    this.card = id;
    document.body.classList.add('dragging');
    // A touch drag follows touch events: the browser may cancel the pointer once the finger
    // moves (it takes it for a scroll), but touch events keep coming.
    this.touch = touch;
    if (touch) {
      addEventListener('touchmove', this.touchMove, { passive: false });
      addEventListener('touchend', this.up);
      addEventListener('touchcancel', this.cancel);
    } else {
      addEventListener('pointermove', this.move);
      addEventListener('pointerup', this.up);
      addEventListener('pointercancel', this.cancel);
    }
    addEventListener('keydown', this.key);
    this.locate();
    this.raf = requestAnimationFrame(this.tick);
  }

  private touch = false;

  private touchMove = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    const t = e.touches[0];
    if (t) this.move(t);
  };

  private move = (e: { clientX: number; clientY: number }) => {
    this.point = { x: e.clientX, y: e.clientY };
    if (this.ghost) {
      this.ghost.style.left = `${e.clientX - this.offset.x}px`;
      this.ghost.style.top = `${e.clientY - this.offset.y}px`;
    }
    this.locate();
  };

  /** Which column the pointer is over, and between which of its cards. */
  private locate() {
    const { x, y } = this.point;
    const lanes = [...document.querySelectorAll<HTMLElement>('[data-lane]')];
    const lane = lanes.find((l) => {
      const r = l.getBoundingClientRect();
      return x >= r.left && x <= r.right;
    });
    if (!lane) return;
    const cards = [...lane.querySelectorAll<HTMLElement>('[data-card]')].filter((c) => c.dataset.card !== this.card);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    const column = lane.dataset.lane!;
    if (this.drop?.column !== column || this.drop.index !== index) this.drop = { column, index };
  }

  /** Scroll the board sideways, or a column up and down, while the pointer is near an edge. */
  private tick = () => {
    if (!this.card) return;
    const { x, y } = this.point;
    const s = this.scroller;
    if (s) {
      const r = s.getBoundingClientRect();
      if (x < r.left + EDGE_PX) s.scrollLeft -= 12;
      else if (x > r.right - EDGE_PX) s.scrollLeft += 12;
    }
    const lane = this.drop && document.querySelector<HTMLElement>(`[data-lane="${this.drop.column}"] [data-scroll]`);
    if (lane) {
      const r = lane.getBoundingClientRect();
      if (y < r.top + EDGE_PX) lane.scrollTop -= 10;
      else if (y > r.bottom - EDGE_PX) lane.scrollTop += 10;
    }
    this.locate();
    this.raf = requestAnimationFrame(this.tick);
  };

  private up = () => {
    const card = this.card;
    const drop = this.drop;
    this.end();
    if (card && drop) {
      this.justDropped = true;
      setTimeout(() => (this.justDropped = false), 50);
      this.onDrop?.(card, drop);
    }
  };

  private cancel = () => this.end();

  private key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.end();
  };

  private end() {
    cancelAnimationFrame(this.raf);
    this.ghost?.remove();
    this.ghost = null;
    this.card = null;
    this.drop = null;
    document.body.classList.remove('dragging');
    removeEventListener('pointermove', this.move);
    removeEventListener('pointerup', this.up);
    removeEventListener('pointercancel', this.cancel);
    removeEventListener('touchmove', this.touchMove);
    removeEventListener('touchend', this.up);
    removeEventListener('touchcancel', this.cancel);
    removeEventListener('keydown', this.key);
  }
}

export const drag = new Drag();
