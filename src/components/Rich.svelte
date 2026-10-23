<script lang="ts">
  import { blocks, type Inline } from '../lib/format';

  /** A description or comment with its marks shown as formatting (format.ts). Built from elements, never HTML. */
  let { text }: { text: string } = $props();
  const parts = $derived(blocks(text));
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
{#snippet link(p: Inline)}
  {#if p.href}<a href={p.href} target="_blank" rel="noopener noreferrer nofollow">{p.text}</a>{:else}{p.text}{/if}
{/snippet}
{#snippet line(l: Inline[])}{#each l as p, i (i)}{@render piece(p)}{/each}{/snippet}

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
</style>
