<script lang="ts">
  import { mentionsIn } from '../../shared/mentions';
  import type { BoardState } from '../lib/board.svelte';
  import { blocks, type Inline } from '../lib/format';
  import PersonLink from './PersonLink.svelte';

  /**
   * A description or comment with its marks shown as formatting (format.ts), and mentions of the
   * board's people picked out (shared/mentions.ts), each opening who they are. Built from
   * elements, never HTML.
   */
  let { text, b }: { text: string; b?: BoardState } = $props();
  const parts = $derived(blocks(text));
  const people = $derived(b?.members ?? []);

  type Piece = Inline & { at?: string };
  /** A line's pieces, with each mention as a piece of its own. */
  function withMentions(l: Inline[]): Piece[] {
    if (!people.length) return l;
    return l.flatMap((p) => {
      if (p.href) return [p];
      const ms = mentionsIn(p.text, people);
      if (!ms.length) return [p];
      const out: Piece[] = [];
      let from = 0;
      for (const m of ms) {
        if (m.start > from) out.push({ ...p, text: p.text.slice(from, m.start) });
        out.push({ ...p, text: p.text.slice(m.start, m.end), at: m.userId });
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
{#snippet link(p: Piece)}
  {#if p.href}<a href={p.href} target="_blank" rel="noopener noreferrer nofollow">{p.text}</a>{:else if p.at}<PersonLink person={b?.member.get(p.at)} {b}
      ><span class="at">{p.text}</span></PersonLink
    >{:else}{p.text}{/if}
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
