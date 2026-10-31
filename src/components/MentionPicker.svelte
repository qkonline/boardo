<script lang="ts">
  import type { MemberRec } from '../../shared/model';
  import { app } from '../lib/store.svelte';
  import Avatar from './Avatar.svelte';

  /**
   * Typing "@" in a description or comment: the board's people in a balloon just above the @,
   * narrowed as the name is typed. Arrow keys move, Enter or Tab picks, Escape closes; a tap
   * picks too. Picking writes "@Their Name " into the text, which shared/mentions.ts knows
   * again later. Like the formatting keys, it never takes focus from the text box.
   */
  let { el, people }: { el: HTMLTextAreaElement | null; people: MemberRec[] } = $props();

  type Open = { at: number; q: string; list: MemberRec[]; active: number; x: number; y: number; up: boolean };
  let open = $state<Open | null>(null);
  const WORD = /[\p{L}\p{N}_]/u;
  const WIDTH = 280;
  /** Between the list and the line it's for. */
  const GAP = 4;

  /** Where the text box's cursor is on screen: a hidden copy of the box, measured up to it. */
  function caret(box: HTMLTextAreaElement, at: number): { x: number; y: number; h: number } {
    const cs = getComputedStyle(box);
    const copy = document.createElement('div');
    // Each property on its own: Safari can report the shorthands (font, padding, border) as empty.
    for (const k of [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'letterSpacing',
      'lineHeight',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
      'borderStyle',
      'boxSizing',
      'width',
      'textIndent',
      'tabSize',
    ] as const)
      copy.style[k] = cs[k];
    Object.assign(copy.style, { position: 'fixed', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '-9999px' });
    copy.textContent = box.value.slice(0, at);
    const mark = document.createElement('span');
    mark.textContent = '​';
    copy.append(mark);
    document.body.append(copy);
    const r = box.getBoundingClientRect();
    const h = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const out = { x: r.left + mark.offsetLeft - box.scrollLeft, y: r.top + mark.offsetTop - box.scrollTop, h };
    copy.remove();
    return out;
  }

  function look(): void {
    const box = el;
    if (!box || box.selectionStart !== box.selectionEnd || document.activeElement !== box) return void (open = null);
    const v = box.value;
    const c = box.selectionStart;
    const at = v.lastIndexOf('@', c - 1);
    if (at < 0 || (at > 0 && WORD.test(v[at - 1]))) return void (open = null);
    const q = v.slice(at + 1, c);
    if (q.includes('\n') || q.length > 30 || /\s\s|^\s/.test(q)) return void (open = null);
    const want = q.toLowerCase();
    const list = people
      .filter((p) => p.userId !== app.user?.id)
      .filter((p) => !want || p.name.toLowerCase().startsWith(want) || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(want)))
      .slice(0, 6);
    if (!list.length) return void (open = null);
    const pos = caret(box, at);
    // Just above the line with the @; below it only when there isn't room above.
    const tall = list.length * 44 + 12 + 34;
    const up = pos.y - GAP - tall >= 8;
    open = {
      at,
      q,
      list,
      active: open && open.at === at ? Math.min(open.active, list.length - 1) : 0,
      x: Math.max(8, Math.min(pos.x - 6, document.documentElement.clientWidth - WIDTH - 8)),
      y: up ? pos.y - GAP : pos.y + pos.h + GAP,
      up,
    };
  }

  function pick(p: MemberRec): void {
    const box = el;
    if (!box || !open) return;
    const c = box.selectionStart;
    const text = `@${p.name} `;
    box.value = box.value.slice(0, open.at) + text + box.value.slice(c);
    const to = open.at + text.length;
    box.setSelectionRange(to, to);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    open = null;
    box.focus();
  }

  function key(e: KeyboardEvent): void {
    if (!open || e.isComposing) return;
    const n = open.list.length;
    const stop = () => (e.preventDefault(), e.stopImmediatePropagation());
    if (e.key === 'ArrowDown') (stop(), (open.active = (open.active + 1) % n));
    else if (e.key === 'ArrowUp') (stop(), (open.active = (open.active - 1 + n) % n));
    else if (e.key === 'Enter' || e.key === 'Tab') (stop(), pick(open.list[open.active]));
    else if (e.key === 'Escape') (stop(), (open = null));
  }

  $effect(() => {
    const box = el;
    if (!box) return;
    const later = () => requestAnimationFrame(look);
    const away = () => setTimeout(() => document.activeElement !== box && (open = null), 0);
    // Capture, so these keys reach the list before the text box's own (lists, the card's Escape).
    box.addEventListener('keydown', key, true);
    box.addEventListener('input', later);
    box.addEventListener('click', later);
    box.addEventListener('keyup', later);
    box.addEventListener('blur', away);
    return () => {
      box.removeEventListener('keydown', key, true);
      box.removeEventListener('input', later);
      box.removeEventListener('click', later);
      box.removeEventListener('keyup', later);
      box.removeEventListener('blur', away);
    };
  });

  /** The typed part of a name, in bold. */
  function parts(name: string, q: string): [string, string, string] {
    if (!q) return ['', '', name];
    const lower = name.toLowerCase();
    const i = lower.startsWith(q.toLowerCase()) ? 0 : lower.indexOf(' ' + q.toLowerCase()) + 1;
    return [name.slice(0, i), name.slice(i, i + q.length), name.slice(i + q.length)];
  }
</script>

{#if open}
  <div
    class="mentions"
    class:up={open.up}
    role="listbox"
    aria-label="People in this board"
    style:left="{open.x}px"
    style:top="{open.y}px"
    style:width="{WIDTH}px"
  >
    {#each open.list as p, i (p.userId)}
      {@const [a, b, c] = parts(p.name, open.q)}
      <button
        type="button"
        role="option"
        tabindex="-1"
        aria-selected={i === open.active}
        class:on={i === open.active}
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => pick(p)}
      >
        <Avatar person={p} size={28} />
        <span class="name">{a}<b>{b}</b>{c}</span>
        <span class="role">{p.role === 'admin' ? 'Admin' : 'Member'}</span>
      </button>
    {/each}
    <p class="hint">Only people in this board can be mentioned</p>
  </div>
{/if}

<style>
  .mentions {
    position: fixed;
    z-index: 70;
    padding: 6px;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: var(--r-card);
    box-shadow:
      0 14px 34px -10px rgba(0, 0, 0, 0.3),
      0 2px 0 var(--line);
    animation: pop 120ms ease-out;
  }
  .up {
    translate: 0 -100%;
  }
  button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 8px;
    border: none;
    border-radius: var(--r-ctl);
    background: none;
    color: var(--text);
    font: 400 15px/1.2 var(--font);
    text-align: left;
    cursor: pointer;
  }
  button.on {
    background: var(--tint-indigo);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name b {
    font-weight: 600;
  }
  .role {
    font-size: 12px;
    color: var(--muted);
  }
  .hint {
    margin: 4px 0 0;
    padding: 6px 8px 2px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--muted);
  }
  @keyframes pop {
    from {
      opacity: 0;
    }
  }
</style>
