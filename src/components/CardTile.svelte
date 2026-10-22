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

  /** A card in a column (design A, Rails): a status bar on its left edge and a quiet meta line. */
  let { card, b, showBoard = false }: { card: CardRec; b: BoardState; showBoard?: boolean } = $props();

  const status = $derived(statusOption(card, b.statusField));
  const bar = $derived(statusColors(status?.hue ?? 'slate').bar);
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
  style:--bar={bar}
  onclick={open}
  aria-label="{card.title || 'Untitled'}{status ? `, ${status.label}` : ''}{due ? `, ${due.label}` : ''}"
>
  {#if showBoard && b.board}
    <span class="board">{b.board.name}</span>
  {/if}
  <span class="t">{card.title || 'Untitled'}</span>
  {#if status || dates || comments || files || card.assignees.length}
    <span class="foot">
      <span class="meta">
        {#if due}
          <span class:late={due.late} class:soon={due.soon} title={dates}><Icon name="cal" size={15} />{due.label}</span>
        {:else if dates}
          <span title={dates}><Icon name="cal" size={15} />{dates}</span>
        {/if}
        {#if comments}<span><Icon name="chat" size={15} />{comments}</span>{/if}
        {#if files}<span><Icon name="clip" size={15} />{files}</span>{/if}
        {#if parts.length}
          <span class="parts" title="{parts.filter(Boolean).length} of {parts.length} done">
            {#each parts as p, i (i)}<i class:on={p}></i>{/each}
          </span>
        {:else if mineDone && !completed}
          <span class="mine">Your part is done</span>
        {/if}
      </span>
      {#if card.assignees.length}
        <span class="avs">
          {#each card.assignees.slice(0, 4) as u (u)}<Avatar person={b.member.get(u)} size={22} />{/each}
          {#if card.assignees.length > 4}<span class="more">+{card.assignees.length - 4}</span>{/if}
        </span>
      {/if}
    </span>
  {/if}
</button>

<style>
  .card {
    position: relative;
    display: grid;
    gap: 7px;
    width: 100%;
    text-align: left;
    padding: 10px 10px 10px 16px;
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: var(--r-ctl);
    box-shadow: 0 1px 0 var(--line);
    cursor: pointer;
    font: inherit;
    color: var(--text);
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
  }
  .card::before {
    content: '';
    position: absolute;
    left: 6px;
    top: 9px;
    bottom: 9px;
    width: 4px;
    border-radius: var(--r-bar);
    background: var(--bar);
  }
  @media (hover: hover) {
    .card:hover {
      border-color: var(--line);
    }
  }
  .card.lifted {
    opacity: 0.35;
  }
  .board {
    font-size: 12px;
    color: var(--muted);
    font-weight: 500;
  }
  .t {
    font-weight: 500;
    font-size: 14.5px;
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
    gap: 4px 10px;
    color: var(--muted);
    font-size: 12.5px;
    min-width: 0;
  }
  .meta > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .late {
    color: var(--redT);
    font-weight: 600;
  }
  .soon {
    color: var(--text);
    font-weight: 500;
  }
  .mine {
    color: var(--grT);
  }
  .parts {
    gap: 3px !important;
  }
  .parts i {
    width: 13px;
    height: 6px;
    border-radius: 1px;
    background: var(--line);
  }
  .parts i.on {
    background: var(--s-lime);
  }
  .avs {
    display: flex;
    gap: 3px;
    flex: none;
    align-items: center;
  }
  .more {
    font-size: 11.5px;
    color: var(--muted);
    margin-left: 2px;
  }
</style>
