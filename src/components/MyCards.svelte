<script lang="ts">
  import Bell from './Bell.svelte';
  import type { CardRec } from '../../shared/model';
  import { statusOption } from '../../shared/rules';
  import { dayOf, daysBetween, todayKey } from '../lib/dates';
  import { hueColor } from '../lib/hue';
  import { app } from '../lib/store.svelte';
  import CardTile from './CardTile.svelte';

  /**
   * Every card assigned to me, across my boards (R7.1 to R7.5), grouped by deadline (Overdue,
   * Today, This week, Later, No date) or by project. Opening one opens the real card.
   */
  type Row = (typeof app.myCards)[number];
  const today = $derived(todayKey());

  function finished(r: Row): boolean {
    return statusOption(r.card, r.state.statusField)?.role === 'completed' || r.card.done[app.user!.id] != null;
  }

  const dueKey = (c: CardRec) => {
    const v = c.values.end ?? c.values.start;
    return typeof v === 'string' && v ? dayOf(v) : null;
  };

  const open = $derived(app.myCards.filter((r) => !finished(r)));
  const done = $derived(app.myCards.filter(finished));

  const byDeadline = $derived.by(() => {
    const groups: { name: string; rows: Row[]; late?: boolean }[] = [
      { name: 'Overdue', rows: [], late: true },
      { name: 'Today', rows: [] },
      { name: 'This week', rows: [] },
      { name: 'Later', rows: [] },
      { name: 'No date', rows: [] },
    ];
    for (const r of open) {
      const k = dueKey(r.card);
      if (!k) groups[4].rows.push(r);
      else {
        const d = daysBetween(today, k);
        groups[d < 0 ? 0 : d === 0 ? 1 : d <= 6 ? 2 : 3].rows.push(r);
      }
    }
    for (const g of groups) g.rows.sort((a, b) => (dueKey(a.card) ?? '9').localeCompare(dueKey(b.card) ?? '9'));
    return groups.filter((g) => g.rows.length);
  });

  const byProject = $derived(
    app.boards
      .map((b) => ({ board: b, rows: open.filter((r) => r.board.id === b.id) }))
      .filter((g) => g.rows.length)
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => (dueKey(a.card) ?? '9').localeCompare(dueKey(b.card) ?? '9')) })),
  );

  let showDone = $state(false);

  // Boards whose cards haven't reached this device yet: until they have, the list can't be whole.
  const unloaded = $derived(app.boards.filter((x) => !app.data[x.id]?.loaded).length);
  const unreachable = $derived(app.boards.some((x) => !app.data[x.id]?.loaded && app.data[x.id]?.status === 'offline'));
  const waiting = $derived(
    !unloaded
      ? ''
      : !app.online
        ? `${unloaded === 1 ? "1 board hasn't" : `${unloaded} boards haven't`} loaded on this device yet. Connect to see ${unloaded === 1 ? 'its' : 'their'} cards.`
        : unreachable
          ? "Can't reach some of your boards right now. Trying again…"
          : unloaded === app.boards.length
            ? 'Loading your boards…'
            : `Still loading ${unloaded === 1 ? '1 board' : `${unloaded} boards`}…`,
  );
</script>

<main class="page">
  <header class="head">
    <h1>My cards</h1>
    <Bell where="head" />
    <div class="seg" role="group" aria-label="Group by">
      <button aria-pressed={app.myCardsBy === 'deadline'} onclick={() => (app.myCardsBy = 'deadline')}>By deadline</button>
      <button aria-pressed={app.myCardsBy === 'project'} onclick={() => (app.myCardsBy = 'project')}>By project</button>
    </div>
  </header>
  <p class="note">Only you see this. It lists every card assigned to you, from all your boards.</p>

  {#if waiting && open.length}
    <p class="waiting" role="status">{waiting}</p>
  {/if}
  {#if !open.length}
    <div class="empty" role="status">
      {#if waiting}{waiting}{:else if app.boards.length}Nothing assigned to you right now.{:else}Once you're in a board, cards assigned to you show here.{/if}
    </div>
  {:else}
    <!-- On a phone, one group under another; on a computer, side by side like a board's columns. -->
    <div class="groups">
      {#if app.myCardsBy === 'deadline'}
        {#each byDeadline as g (g.name)}
          <section class="group">
            <h2 class:late={g.late}>{g.name} <small>{g.rows.length}</small></h2>
            <div class="list">
              {#each g.rows as r (r.board.id + r.card.id)}<CardTile card={r.card} b={r.state} showBoard />{/each}
            </div>
          </section>
        {/each}
      {:else}
        {#each byProject as g (g.board.id)}
          <section class="group">
            <h2><span class="mark" style:background={hueColor(g.board.hue)}></span>{g.board.name} <small>{g.rows.length}</small></h2>
            <div class="list">
              {#each g.rows as r (r.card.id)}<CardTile card={r.card} b={r.state} />{/each}
            </div>
          </section>
        {/each}
      {/if}
    </div>
  {/if}

  {#if done.length}
    <section>
      <button class="btn ghost more" aria-expanded={showDone} onclick={() => (showDone = !showDone)}
        >{showDone ? 'Hide' : 'Show'} done ({done.length})</button
      >
      {#if showDone}
        <div class="list done">
          {#each done as r (r.board.id + r.card.id)}<CardTile card={r.card} b={r.state} showBoard />{/each}
        </div>
      {/if}
    </section>
  {/if}
</main>

<style>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: max(20px, env(safe-area-inset-top)) max(var(--px), env(safe-area-inset-right))
      calc(var(--bar-h) + 40px + env(safe-area-inset-bottom)) max(var(--px), env(safe-area-inset-left));
    display: grid;
    gap: 18px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  /* On a phone the bell stays beside the title, and the switch goes below if it must. */
  .head h1 {
    flex: 1;
  }
  @media (min-width: 768px) {
    .head h1 {
      flex: none;
    }
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 600;
  }
  .note {
    margin: -10px 0 0;
    color: var(--muted);
    font-size: 14px;
  }
  .seg {
    display: inline-flex;
    background: var(--sunk);
    border-radius: var(--r-ctl);
    padding: 3px;
    gap: 2px;
  }
  .seg button {
    border: none;
    background: transparent;
    color: var(--muted);
    font: 500 13px var(--font);
    min-height: 38px;
    padding: 0 12px;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .seg button[aria-pressed='true'] {
    background: var(--raised);
    color: var(--text);
    box-shadow: 0 1px 0 var(--line);
  }
  section {
    display: grid;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h2 small {
    color: var(--muted);
    font-weight: 500;
  }
  h2.late {
    color: var(--redT);
  }
  .mark {
    width: 12px;
    height: 12px;
    border-radius: 3px;
  }
  .groups {
    display: grid;
    gap: 18px;
  }
  .list {
    display: grid;
    gap: 8px;
  }
  /* A computer: the page takes the width, and the groups sit side by side as columns that scroll
     sideways when there are more than fit, like a board's. Done cards stay below, in a grid. */
  @media (min-width: 768px) {
    .page {
      max-width: none;
    }
    .groups {
      grid-auto-flow: column;
      grid-auto-columns: 290px;
      align-items: start;
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 6px;
    }
    .group {
      gap: 0;
      background: var(--sunk);
      border-radius: var(--r-card);
      padding: 0 8px 8px;
    }
    .group h2 {
      min-height: 44px;
      margin: 2px 0 0 6px;
    }
    .list.done {
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    }
  }
  .waiting {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }
  .empty {
    padding: 24px 16px;
    border: 1px dashed var(--line);
    border-radius: var(--r-card);
    color: var(--muted);
  }
  .more {
    justify-self: start;
    color: var(--muted);
    padding: 0;
  }
  @media (pointer: coarse) {
    .seg button {
      min-height: 44px;
    }
  }
</style>
