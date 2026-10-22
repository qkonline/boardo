<script lang="ts">
  import type { CardRec } from '../../shared/model';
  import { statusOption } from '../../shared/rules';
  import type { BoardState } from '../lib/board.svelte';
  import { deadline, range } from '../lib/dates';
  import { drag } from '../lib/drag.svelte';
  import { statusColors } from '../lib/hue';
  import { app } from '../lib/store.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  /**
   * A card in a column: its status, when it has one, as a tinted band across the top (with each
   * person's part as a segment), then the title, its dates and counts, and who's on it.
   */
  let { card, b, showBoard = false }: { card: CardRec; b: BoardState; showBoard?: boolean } = $props();

  const status = $derived(statusOption(card, b.statusField));
  const colors = $derived(statusColors(status?.hue ?? 'slate'));
  const completed = $derived(status?.role === 'completed');
  const due = $derived(completed ? null : deadline(card.values.end ?? card.values.start));
  const dates = $derived(range(card.values.start, card.values.end));
  const comments = $derived(b.commentsOn(card.id).length);
  const files = $derived(b.filesOn(card.id).length);
  const parts = $derived(card.assignees.length > 1 ? card.assignees.map((u) => card.done[u] != null) : []);
  const mineDone = $derived(app.user ? card.done[app.user.id] != null : false);

  function open() {
    if (drag.justDropped) return;
    app.openCard(b.id, card.id);
  }
</script>

<button
  class="card"
  class:lifted={drag.card === card.id}
  class:completed
  data-card={card.id}
  onclick={open}
  aria-label="{card.title || 'Untitled'}{status ? `, ${status.label}` : ''}{due ? `, ${due.label}` : ''}"
>
  {#if status}
    <span class="band" style:background={colors.tint} style:color={colors.text}>
      <span>{status.label}</span>
      {#if parts.length}{@render segments()}{/if}
    </span>
  {/if}
  <span class="body">
    {#if showBoard && b.board}
      <span class="board">{b.board.name}</span>
    {/if}
    <span class="t">{card.title || 'Untitled'}</span>
    {#if dates || comments || files || card.assignees.length || (!status && parts.length)}
      <span class="foot">
        <span class="meta">
          {#if due}
            <span class:late={due.late} class:soon={due.soon} title={dates}><Icon name="cal" size={16} />{due.label}</span>
          {:else if dates}
            <span title={dates}><Icon name="cal" size={16} />{dates}</span>
          {/if}
          {#if comments}<span><Icon name="chat" size={16} />{comments}</span>{/if}
          {#if files}<span><Icon name="clip" size={16} />{files}</span>{/if}
          {#if !status && parts.length}{@render segments()}{:else if mineDone && !completed && !parts.length}
            <span class="mine">Your part is done</span>
          {/if}
        </span>
        {#if card.assignees.length}
          <span class="avs">
            {#each card.assignees.slice(0, 4) as u (u)}<Avatar person={b.member.get(u)} size={26} />{/each}
            {#if card.assignees.length > 4}<span class="more">+{card.assignees.length - 4}</span>{/if}
          </span>
        {/if}
      </span>
    {/if}
  </span>
</button>

{#snippet segments()}
  <span class="parts" title="{parts.filter(Boolean).length} of {parts.length} done">
    {#each parts as p, i (i)}<i class:on={p}></i>{/each}
  </span>
{/snippet}

<style>
  .card {
    display: grid;
    width: 100%;
    padding: 0;
    text-align: left;
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    box-shadow: 0 2px 0 var(--line);
    overflow: hidden;
    cursor: pointer;
    font: inherit;
    color: var(--text);
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
  }
  @media (hover: hover) {
    .card:hover {
      border-color: var(--line);
    }
  }
  .card.lifted {
    opacity: 0.35;
  }
  .band {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    font: 600 12.5px/1.2 var(--font);
  }
  .body {
    display: grid;
    gap: 9px;
    padding: 10px 12px 12px;
  }
  .board {
    font-size: 12px;
    color: var(--muted);
    font-weight: 500;
  }
  .t {
    font-weight: 600;
    font-size: 15.5px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .completed .t {
    color: var(--muted);
  }
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 12px;
    color: var(--muted);
    font-size: 13px;
    min-width: 0;
  }
  .meta > span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .late {
    color: var(--redT);
    font-weight: 500;
  }
  .soon {
    color: var(--text);
    font-weight: 500;
  }
  .mine {
    color: var(--grT);
  }
  .parts {
    display: inline-flex;
    gap: 3px;
    flex: none;
  }
  .parts i {
    width: 14px;
    height: 6px;
    border-radius: 1px;
    background: color-mix(in oklab, currentColor 25%, transparent);
  }
  .meta .parts i {
    background: var(--line);
  }
  .parts i.on,
  .meta .parts i.on {
    background: var(--s-lime);
  }
  .avs {
    display: flex;
    gap: 4px;
    flex: none;
    align-items: center;
  }
  .more {
    font-size: 11.5px;
    color: var(--muted);
    margin-left: 2px;
  }
</style>
