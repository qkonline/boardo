<script lang="ts">
  import type { CardRec } from '../../shared/model';
  import { statusOption } from '../../shared/rules';
  import type { BoardState } from '../lib/board.svelte';
  import { deadline, range } from '../lib/dates';
  import { drag } from '../lib/drag.svelte';
  import { plain } from '../lib/format';
  import { app } from '../lib/store.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import StatusChip from './StatusChip.svelte';

  /**
   * A card in a column: the title, then one row with its status (when it has one), its dates and
   * counts, and who's on it, a green tick on each person whose part is done.
   */
  let { card, b, showBoard = false }: { card: CardRec; b: BoardState; showBoard?: boolean } = $props();

  const status = $derived(statusOption(card, b.statusField));
  const completed = $derived(status?.role === 'completed');
  const due = $derived(completed ? null : deadline(card.values.end ?? card.values.start));
  const dates = $derived(range(card.values.start, card.values.end));
  const comments = $derived(b.commentsOn(card.id).length);
  const files = $derived(b.filesOn(card.id).length);
  const doneCount = $derived(card.assignees.filter((u) => card.done[u] != null).length);
  /** A hint that there's a description to read: its first words, up to two lines. */
  const preview = $derived(card.desc ? plain(card.desc).slice(0, 240) : '');

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
  aria-label="{card.title || 'Untitled'}{status ? `, ${status.label}` : ''}{due ? `, ${due.label}` : ''}{card.assignees.length > 1
    ? `, ${doneCount} of ${card.assignees.length} done`
    : ''}"
>
  <span class="body">
    {#if showBoard && b.board}
      <span class="board">{b.board.name}</span>
    {/if}
    <span class="top">
      <span class="t">{card.title || 'Untitled'}</span>
      {#if preview}<span class="desc">{preview}</span>{/if}
    </span>
    {#if status || dates || comments || files || card.assignees.length}
      <span class="foot">
        <span class="meta">
          {#if status}<span class="st"><StatusChip option={status} /></span>{/if}
          {#if due}
            <span class:late={due.late} class:soon={due.soon} title={dates}><Icon name="cal" size={16} />{due.label}</span>
          {:else if dates}
            <span title={dates}><Icon name="cal" size={16} />{dates}</span>
          {/if}
          {#if comments}<span><Icon name="chat" size={16} />{comments}</span>{/if}
          {#if files}<span><Icon name="clip" size={16} />{files}</span>{/if}
        </span>
        {#if card.assignees.length}
          <span class="avs">
            {#each card.assignees.slice(0, 4) as u (u)}
              {@const m = b.member.get(u)}
              <span
                class="av"
                title={card.done[u] != null ? (card.assignees.length > 1 ? `${m?.name ?? 'Someone'}'s part is done` : `${m?.name ?? 'Someone'} is done`) : m?.name}
                ><Avatar person={m} size={26} />{#if card.done[u] != null}<span class="tick"><Icon name="check" size={9} plain /></span>{/if}</span
              >
            {/each}
            {#if card.assignees.length > 4}<span class="more">+{card.assignees.length - 4}</span>{/if}
          </span>
        {/if}
      </span>
    {/if}
  </span>
</button>


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
  /* The title, with its description's first words close under it. */
  .top {
    display: grid;
    gap: 3px;
  }
  .desc {
    font-size: 13px;
    line-height: 1.4;
    color: var(--muted);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  /* When the status, dates and counts wrap, their lines sit 8px apart. */
  .meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
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
  /* A done part: a green tick on the person's avatar, as in the card window. */
  .av {
    position: relative;
    display: inline-flex;
  }
  .tick {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 13px;
    height: 13px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--s-lime);
    color: #fff;
    box-shadow: 0 0 0 2px var(--raised);
  }
  /* The chip sits on the row's line, so the icons beside it stay level with it. */
  .st {
    display: inline-flex;
    margin-left: -1px;
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
