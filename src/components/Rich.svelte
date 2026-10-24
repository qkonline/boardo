<script lang="ts">
  import { mentionsIn, type Named } from '../../shared/mentions';
  import { blocks, type Inline } from '../lib/format';

  /**
   * A description or comment with its marks shown as formatting (format.ts), and mentions of the
   * board's `people` picked out (shared/mentions.ts). Built from elements, never HTML.
   */
  let { text, people = [] }: { text: string; people?: Named[] } = $props();
  const parts = $derived(blocks(text));

  /** A line's pieces, with each mention as a piece of its own. */
  function withMentions(l: Inline[]): (Inline & { at?: boolean })[] {
    if (!people.length) return l;
    return l.flatMap((p) => {
      if (p.href) return [p];
      const ms = mentionsIn(p.text, people);
      if (!ms.length) return [p];
      const out: (Inline & { at?: boolean })[] = [];
      let from = 0;
      for (const m of ms) {
        if (m.start > from) out.push({ ...p, text: p.text.slice(from, m.start) });
        out.push({ ...p, text: p.text.slice(m.start, m.end), at: true });
        from = m.end;
      }
      if (from < p.text.length) out.push({ ...p, text: p.text.slice(from) });
      return out;
    });
  }
</script>

{#snippet piece(p: Inline)}
  {#if p.b}<strong>{@render italic(p)}</strong>{:else}{@render italic(p)}{/if}
{/snippet}
{#snippet italic(p: Inline)}
  {#if p.i}<em>{@render struck(p)}</em>{:else}{@render struck(p)}{/if}
{/snippet}
{#snippet struck(p: Inline)}
  {#if p.s}<s>{@render link(p)}</s>{:else}{@render link(p)}{/if}
{/snippet}
{#snippet link(p: Inline & { at?: boolean })}
  {#if p.href}<a href={p.href} target="_blank" rel="noopener noreferrer nofollow">{p.text}</a>{:else if p.at}<span class="at">{p.text}</span>{:else}{p.text}{/if}
{/snippet}
{#snippet line(l: Inline[])}{#each withMentions(l) as p, i (i)}{@render piece(p)}{/each}{/snippet}

<div class="rich">
  {#each parts as bl, i (i)}
    {#if bl.kind === 'p'}
      <p>{#each bl.lines as l, j (j)}{#if j}<br />{/if}{@render line(l)}{/each}</p>
    {:else if bl.kind === 'ul'}
      <ul>{#each bl.items as l, j (j)}<li>{@render line(l)}</li>{/each}</ul>
    {:else}
      <ol start={bl.start}>{#each bl.items as l, j (j)}<li>{@render line(l)}</li>{/each}</ol>
    {/if}
  {/each}
</div>

<style>
  .rich {
    display: grid;
    gap: 8px;
    overflow-wrap: anywhere;
  }
  p,
  ul,
  ol {
    margin: 0;
  }
  ul,
  ol {
    padding-left: 22px;
    display: grid;
    gap: 2px;
  }
  li::marker {
    color: var(--muted);
  }
  strong {
    font-weight: 600;
  }
  s {
    color: var(--muted);
  }
  /* Someone mentioned. */
  .at {
    color: var(--t-indigo);
    background: var(--tint-indigo);
    border-radius: 5px;
    padding: 0 3px;
    font-weight: 500;
  }
</style>
