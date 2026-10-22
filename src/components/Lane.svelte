<script lang="ts">
  import type { CardRec, ColumnRec } from '../../shared/model';
  import type { BoardState } from '../lib/board.svelte';
  import { drag } from '../lib/drag.svelte';
  import { app } from '../lib/store.svelte';
  import CardTile from './CardTile.svelte';
  import Icon from './Icon.svelte';

  /** One column: its name and count, its cards straight on the page, and an Add a card key. */
  let {
    col,
    b,
    cards,
    filtered,
    onmenu,
  }: { col: ColumnRec; b: BoardState; cards: CardRec[]; filtered: boolean; onmenu: () => void } = $props();

  let adding = $state(false);
  let title = $state('');
  let input: HTMLTextAreaElement | null = $state(null);
  let list: HTMLDivElement | null = $state(null);

  // Where a dragged card would land in this lane (index among the cards other than it). The
  // dragged card stays in place, faded: its touch events need it to stay in the page.
  const dropAt = $derived(drag.drop?.column === col.id ? drag.drop.index : -1);
  const slots = $derived.by(() => {
    let i = 0;
    return cards.map((c) => (c.id === drag.card ? -1 : i++));
  });
  const others = $derived(slots.filter((s) => s >= 0).length);

  async function add(e?: Event) {
    e?.preventDefault();
    const t = title.trim();
    if (!t) return;
    title = '';
    await app.addCard(b.id, col.id, t);
    queueMicrotask(() => {
      input?.focus();
      list?.scrollTo({ top: list.scrollHeight });
    });
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void add();
    } else if (e.key === 'Escape') {
      adding = false;
      title = '';
    }
  }
</script>

<section class="lane" data-lane={col.id} aria-label={col.name}>
  <header class="lane-h">
    <h2>{col.name || 'Untitled column'} <span class="n">{cards.length}</span></h2>
    <button class="icon-btn" aria-label="Column options for {col.name}" onclick={onmenu}><Icon name="more" /></button>
  </header>
  <div class="cards" data-scroll bind:this={list}>
    {#each cards as c, i (c.id)}
      {#if dropAt >= 0 && dropAt === slots[i]}<div class="drop" aria-hidden="true"></div>{/if}
      <CardTile card={c} {b} />
    {/each}
    {#if dropAt >= 0 && dropAt === others}<div class="drop" aria-hidden="true"></div>{/if}
    {#if !cards.length && filtered}
      <p class="none">No cards match.</p>
    {/if}
    {#if adding}
      <form class="adder" onsubmit={add}>
        <textarea
          class="field"
          rows="2"
          placeholder="What needs doing?"
          aria-label="New card title"
          maxlength="300"
          bind:value={title}
          bind:this={input}
          onkeydown={key}
          onblur={() => !title.trim() && (adding = false)}
        ></textarea>
        <div class="row">
          <button class="key ink" type="submit" disabled={!title.trim()}>Add card</button>
          <button class="btn ghost" type="button" onclick={() => ((adding = false), (title = ''))}>Cancel</button>
        </div>
      </form>
    {/if}
  </div>
  {#if !adding}
    <button
      class="key add"
      onclick={() => {
        adding = true;
        queueMicrotask(() => input?.focus());
      }}><Icon name="plus" /> Add a card</button
    >
  {/if}
</section>

<style>
  .lane {
    flex: 0 0 min(84vw, 320px);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    scroll-snap-align: start;
    min-width: 0;
  }
  @media (min-width: 768px) {
    .lane {
      flex-basis: 290px;
    }
  }
  .lane-h {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 0 4px;
    min-height: 44px;
  }
  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    overflow-wrap: anywhere;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .n {
    font: 600 12.5px/1 var(--font);
    color: var(--muted);
    background: var(--sunk);
    border-radius: var(--r-sm);
    padding: 4px 7px;
    flex: none;
  }
  .cards {
    flex: 1 1 auto;
    min-height: 12px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 2px 2px 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .drop {
    height: 4px;
    margin: -2px 2px;
    border-radius: 2px;
    background: var(--accent);
    flex: none;
  }
  .none {
    margin: 4px 6px;
    color: var(--faint);
    font-size: 13px;
  }
  .add {
    margin: 6px 2px 4px;
    width: calc(100% - 4px);
    flex: none;
    font-size: 15px;
    min-height: 48px;
  }
  .adder {
    display: grid;
    gap: 8px;
  }
  .adder textarea {
    min-height: 64px;
    resize: none;
  }
  .row {
    display: flex;
    gap: 8px;
  }
</style>
