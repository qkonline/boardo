<script lang="ts">
  import type { CardRec, ColumnRec } from '../../shared/model';
  import type { BoardState } from '../lib/board.svelte';
  import { drag } from '../lib/drag.svelte';
  import { app } from '../lib/store.svelte';
  import CardTile from './CardTile.svelte';
  import Icon from './Icon.svelte';

  /** One column: a sunk lane with its name, its cards, and Add a card. */
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
    <h2>{col.name || 'Untitled column'}</h2>
    <span class="n">{cards.length}</span>
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
      class="add"
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
    background: var(--sunk);
    border-radius: var(--r-card);
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
    margin: 2px 8px 0 14px;
    min-height: 44px;
  }
  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .n {
    color: var(--faint);
    font-weight: 500;
    font-size: 13px;
  }
  .cards {
    flex: 1 1 auto;
    min-height: 12px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 2px 8px 4px;
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
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 8px 8px;
    padding: 0 8px;
    min-height: 44px;
    border: none;
    border-radius: var(--r-ctl);
    background: transparent;
    color: var(--muted);
    font: 500 14px var(--font);
    cursor: pointer;
    flex: none;
  }
  @media (hover: hover) {
    .add:hover {
      background: color-mix(in oklab, var(--text) 6%, transparent);
    }
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
