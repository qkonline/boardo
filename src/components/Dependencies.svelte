<script lang="ts">
  import type { CardRec } from '../../shared/model';
  import type { BoardState } from '../lib/board.svelte';
  import { statusColors } from '../lib/hue';
  import Balloon from './Balloon.svelte';
  import Icon from './Icon.svelte';
  import StatusChip from './StatusChip.svelte';

  /**
   * What a card waits on, and what waits on it, along one rail: the cards to finish first hang
   * above "This card", the cards it holds up hang below. `deps` is the card's list as drafted;
   * changes go back through `onchange` and wait for Save like everything else on the card.
   */
  let {
    b,
    cardId,
    deps,
    onchange,
    onopen,
  }: { b: BoardState; cardId: string; deps: string[]; onchange: (deps: string[]) => void; onopen: (id: string) => void } = $props();

  const statusOf = (c: CardRec) => b.statusField?.options?.find((o) => o.id === c.values.status);
  const isDone = (c: CardRec) => statusOf(c)?.role === 'completed';

  const waitsOn = $derived(deps.map((d) => b.card.get(d)).filter((c): c is CardRec => !!c));
  const holdsUp = $derived(
    [...b.card.values()].filter((c) => c.id !== cardId && !c.archived && (c.deps ?? []).includes(cardId)).sort((x, y) => x.order - y.order),
  );
  const doneCount = $derived(waitsOn.filter(isDone).length);

  /** Every card that waits on this one, however far down: picking one of them would make a loop. */
  const downstream = $derived.by(() => {
    const seen = new Set<string>([cardId]);
    const queue = [cardId];
    while (queue.length) {
      const at = queue.shift()!;
      for (const c of b.card.values()) if (!seen.has(c.id) && (c.deps ?? []).includes(at)) (seen.add(c.id), queue.push(c.id));
    }
    return seen;
  });

  let query = $state('');
  const choices = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return [...b.card.values()]
      .filter((c) => !c.archived && !downstream.has(c.id) && !deps.includes(c.id))
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      .sort((x, y) => (b.column.get(x.columnId)?.order ?? 0) - (b.column.get(y.columnId)?.order ?? 0) || x.order - y.order);
  });

  const columnName = (c: CardRec) => (c.archived ? 'Archived' : (b.column.get(c.columnId)?.name ?? ''));
  const node = (c: CardRec) => statusColors(statusOf(c)?.hue ?? 'slate').bar;
  const focus = (el: HTMLInputElement) => el.focus();
</script>

{#snippet row(c: CardRec, removable: boolean)}
  {@const done = isDone(c)}
  <li class="row" class:done style:--node={node(c)}>
    <span class="node" aria-hidden="true">{#if done}<Icon name="check" size={12} plain />{/if}</span>
    <button class="open" onclick={() => onopen(c.id)}>
      <span class="t">{c.title || 'Untitled'}</span>
      <span class="col">{columnName(c)}</span>
    </button>
    <span class="st"><StatusChip option={statusOf(c)} /></span>
    {#if removable}
      <button class="icon-btn x" aria-label="Stop waiting on {c.title || 'this card'}" onclick={() => onchange(deps.filter((d) => d !== c.id))}
        ><Icon name="close" size={14} /></button
      >
    {/if}
  </li>
{/snippet}

<section class="deps" aria-label="Dependencies">
  <div class="head">
    <h3>
      <Icon name="deps" size={16} /> Dependencies
      {#if waitsOn.length}
        <span class="sum" class:ready={doneCount === waitsOn.length}
          >{doneCount === waitsOn.length ? 'Ready to start' : `${doneCount} of ${waitsOn.length} done`}</span
        >
      {/if}
    </h3>
    <Balloon label="Wait on a card" align="end" onclose={() => (query = '')}>
      {#snippet trigger({ toggle, open })}
        <button class="btn small" aria-expanded={open} onclick={toggle}><Icon name="plus" /> Add</button>
      {/snippet}
      {#snippet children(close)}
        <div class="pick">
          <input class="field find" type="search" placeholder="Find a card" aria-label="Find a card" bind:value={query} {@attach focus} />
          <div class="list">
            {#each choices as c (c.id)}
              <button class="opt" onclick={() => (onchange([...deps, c.id]), close())}>
                <span class="ot"><span class="t">{c.title || 'Untitled'}</span><span class="col">{columnName(c)}</span></span>
                <StatusChip option={statusOf(c)} />
              </button>
            {:else}
              <p class="none">{query.trim() ? 'No card by that name.' : 'No other cards to pick.'}</p>
            {/each}
          </div>
        </div>
      {/snippet}
    </Balloon>
  </div>

  {#if waitsOn.length || holdsUp.length}
    <div class="rail">
      {#if waitsOn.length}
        <p class="group">Waits on</p>
        <ul>
          {#each waitsOn as c (c.id)}{@render row(c, true)}{/each}
        </ul>
      {/if}
      <p class="self"><span class="me" aria-hidden="true"></span>This card</p>
      {#if holdsUp.length}
        <p class="group">Holds up</p>
        <ul>
          {#each holdsUp as c (c.id)}{@render row(c, false)}{/each}
        </ul>
      {/if}
    </div>
  {:else}
    <p class="empty">Nothing has to finish before this card. Add the cards it waits on.</p>
  {/if}
</section>

<style>
  .deps {
    display: grid;
    gap: 10px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    font: 600 13.5px var(--font);
  }
  .sum {
    font: 600 11px/1 var(--font);
    color: var(--muted);
    background: var(--sunk);
    border-radius: var(--r-sm);
    padding: 4px 7px;
  }
  .sum.ready {
    color: var(--grT);
    background: color-mix(in oklab, var(--s-lime) 16%, transparent);
  }
  .btn.small {
    min-height: 34px;
    padding: 0 10px;
    font-size: 13px;
  }

  /* The rail: one thread from the cards to finish first, through this card, to the ones after. */
  .rail {
    position: relative;
    display: grid;
    gap: 2px;
    padding-left: 2px;
  }
  .rail::before {
    content: '';
    position: absolute;
    left: 9px;
    top: 26px;
    bottom: 18px;
    width: 2px;
    border-radius: 1px;
    background: var(--border);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .group {
    margin: 0;
    padding-left: 30px;
    font: 500 12px/1 var(--font);
    color: var(--muted);
    min-height: 22px;
    display: flex;
    align-items: center;
  }
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto 36px;
    align-items: center;
    gap: 12px;
    min-height: 44px;
  }
  .node {
    position: relative;
    z-index: 1;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--bg);
    border: 2px solid var(--node);
    display: grid;
    place-items: center;
    color: var(--lime-ink);
  }
  .done .node {
    background: var(--s-lime);
    border-color: var(--s-lime);
  }
  .open {
    min-width: 0;
    min-height: 44px;
    display: grid;
    align-content: center;
    gap: 2px;
    padding: 4px 6px;
    margin-left: -6px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  @media (hover: hover) {
    .open:hover {
      background: var(--sunk);
    }
  }
  .t {
    font: 500 14px/1.3 var(--font);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .done .t {
    color: var(--muted);
  }
  .col {
    font-size: 12px;
    color: var(--muted);
  }
  .x {
    width: 36px;
    height: 36px;
    color: var(--muted);
  }
  .self {
    margin: 2px 0;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 30px;
    font: 600 13px var(--font);
    color: var(--accent-text);
  }
  .me {
    position: relative;
    z-index: 1;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    rotate: 45deg;
    scale: 0.8;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--bg);
  }
  .empty {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }

  /* The picker in its balloon. */
  .pick {
    display: grid;
    gap: 6px;
    width: min(300px, 80vw);
  }
  .find {
    min-height: 38px;
    padding: 6px 10px;
    font-size: 14px;
  }
  .list {
    display: grid;
    gap: 2px;
    max-height: 280px;
    overflow-y: auto;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 4px 8px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  @media (hover: hover) {
    .opt:hover {
      background: var(--sunk);
    }
  }
  .ot {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .none {
    margin: 6px 8px;
    color: var(--muted);
    font-size: 13px;
  }
  @media (pointer: coarse) {
    .btn.small {
      min-height: 44px;
    }
    .x {
      width: 44px;
      height: 44px;
    }
  }
</style>
