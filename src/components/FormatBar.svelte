<script lang="ts" module>
  import { enter, list, mark, type Edit } from '../lib/format';

  type Kind = 'b' | 'i' | 's' | 'ul' | 'ol';

  /** Put an edit into the text box as if it was typed, so its bindings and drafts follow. */
  function apply(el: HTMLTextAreaElement, ed: Edit): void {
    el.value = ed.value;
    el.setSelectionRange(ed.start, ed.end);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  export function format(el: HTMLTextAreaElement, kind: Kind): void {
    const { value, selectionStart: a, selectionEnd: z } = el;
    apply(el, kind === 'ul' || kind === 'ol' ? list(value, a, z, kind) : mark(value, a, z, kind));
    el.focus();
  }

  /** The text box's keys: ⌘B, ⌘I, ⌘⇧X, ⌘⇧8, ⌘⇧7, and Enter carrying a list on. True if it was one. */
  export function formatKey(el: HTMLTextAreaElement, e: KeyboardEvent): boolean {
    if (e.isComposing) return false;
    const cmd = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const kind: Kind | null = !cmd
      ? null
      : !e.shiftKey && k === 'b'
        ? 'b'
        : !e.shiftKey && k === 'i'
          ? 'i'
          : e.shiftKey && k === 'x'
            ? 's'
            : e.shiftKey && (e.code === 'Digit8' || k === '*')
              ? 'ul'
              : e.shiftKey && (e.code === 'Digit7' || k === '&')
                ? 'ol'
                : null;
    if (kind) {
      e.preventDefault();
      format(el, kind);
      return true;
    }
    if (e.key === 'Enter' && !cmd && !e.shiftKey && !e.altKey && el.selectionStart === el.selectionEnd) {
      const ed = enter(el.value, el.selectionStart);
      if (!ed) return false;
      e.preventDefault();
      apply(el, ed);
      return true;
    }
    return false;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  /** The formatting keys over a text box. They never take focus from it, so it stays open. */
  let { el }: { el: HTMLTextAreaElement | null } = $props();
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const cmd = mac ? '⌘' : 'Ctrl+';
  const shift = mac ? '⇧' : 'Shift+';
  const KEYS: [Kind, 'bold' | 'italic' | 'strike' | 'bullets' | 'numbers', string, string][] = [
    ['b', 'bold', 'Bold', `${cmd}B`],
    ['i', 'italic', 'Italic', `${cmd}I`],
    ['s', 'strike', 'Strikethrough', `${cmd}${shift}X`],
    ['ul', 'bullets', 'Bulleted list', `${cmd}${shift}8`],
    ['ol', 'numbers', 'Numbered list', `${cmd}${shift}7`],
  ];
</script>

<div class="bar" role="toolbar" aria-label="Formatting">
  {#each KEYS as [kind, icon, label, keys] (kind)}
    <button
      type="button"
      class="fk"
      aria-label={label}
      title="{label} ({keys})"
      onpointerdown={(e) => e.preventDefault()}
      onmousedown={(e) => e.preventDefault()}
      onclick={() => el && format(el, kind)}><Icon name={icon} size={18} /></button
    >
    {#if kind === 's'}<span class="sep" aria-hidden="true"></span>{/if}
  {/each}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
  }
  .fk {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  @media (hover: hover) {
    .fk:hover {
      background: var(--sunk);
    }
  }
  .fk:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--border);
  }
  @media (pointer: coarse) {
    .fk {
      width: 44px;
      height: 44px;
    }
  }
</style>
