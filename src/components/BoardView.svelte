<script lang="ts">
  import type { CardRec } from '../../shared/model';
  import { drag } from '../lib/drag.svelte';
  import { hueColor } from '../lib/hue';
  import { app } from '../lib/store.svelte';
  import ColumnMenu from './ColumnMenu.svelte';
  import Icon from './Icon.svelte';
  import Lane from './Lane.svelte';

  let { id }: { id: string } = $props();
  const b = $derived(app.data[id]);
  const item = $derived(app.boards.find((x) => x.id === id));

  // Filters (R3.6), kept per board while the app is open.
  const filters = $state<Record<string, { person: string; status: string }>>({});
  const f = $derived(filters[id] ?? { person: 'all', status: 'all' });
  const setFilter = (k: 'person' | 'status', v: string) => (filters[id] = { ...f, [k]: v });
  const filtered = $derived(f.person !== 'all' || f.status !== 'all');

  function keep(c: CardRec): boolean {
    if (f.person === 'none' && c.assignees.length) return false;
    if (f.person !== 'all' && f.person !== 'none' && !c.assignees.includes(f.person)) return false;
    if (f.status !== 'all' && (c.values.status ?? 'none') !== f.status) return false;
    return true;
  }

  let menuFor = $state<string | null>(null);
  let addingCol = $state(false);
  let colName = $state('');
  let scroller: HTMLDivElement | null = $state(null);

  async function addColumn(e?: Event) {
    e?.preventDefault();
    const n = colName.trim();
    if (!n) return;
    colName = '';
    await app.addColumn(id, n);
    queueMicrotask(() => scroller?.scrollTo({ left: scroller.scrollWidth, behavior: 'smooth' }));
  }

  function dropped(card: string, d: { column: string; index: number }) {
    const list = b.cardsIn(d.column).filter((c) => c.id !== card);
    void app.moveCard(id, card, d.column, list[d.index - 1]?.id ?? null, list[d.index]?.id ?? null);
  }

  const attachDrag = (el: HTMLElement) => drag.attach(el, () => scroller, dropped);
</script>

{#if b && item}
  <div class="screen">
    <header class="head">
      <button class="icon-btn back" aria-label="Boards" onclick={() => app.go({ name: 'home' })}><Icon name="back" /></button>
      <h1><span class="mark" style:background={hueColor(b.board?.hue ?? item.hue)}></span>{b.board?.name ?? item.name}</h1>
      {#if b.status !== 'live' && app.online && b.loaded}
        <span class="sync" title="Connecting">Connecting</span>
      {/if}
      <div class="acts">
        <button class="btn" onclick={() => (app.activity = id)}><Icon name="log" /><span class="wide">Activity</span></button>
        <button class="icon-btn" aria-label="Board settings" onclick={() => app.go({ name: 'boardSettings', id })}
          ><Icon name="gear" /></button
        >
      </div>
    </header>

    <div class="filters">
      <Icon name="filter" />
      <label class="sel" class:on={f.person !== 'all'}>
        <span class="sr-only">Person</span>
        <select value={f.person} onchange={(e) => setFilter('person', e.currentTarget.value)}>
          <option value="all">Everyone</option>
          {#if app.user}<option value={app.user.id}>Me</option>{/if}
          {#each b.members.filter((m) => m.userId !== app.user?.id) as m (m.userId)}
            <option value={m.userId}>{m.name}</option>
          {/each}
          <option value="none">Nobody yet</option>
        </select>
        <Icon name="down" size={14} />
      </label>
      <label class="sel" class:on={f.status !== 'all'}>
        <span class="sr-only">Status</span>
        <select value={f.status} onchange={(e) => setFilter('status', e.currentTarget.value)}>
          <option value="all">All statuses</option>
          {#each b.statusField?.options ?? [] as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
          <option value="none">No status</option>
        </select>
        <Icon name="down" size={14} />
      </label>
      {#if filtered}
        <button class="btn ghost clear" onclick={() => (filters[id] = { person: 'all', status: 'all' })}>Clear</button>
      {/if}
    </div>

    {#if !b.loaded}
      <p class="wait">{app.online ? 'Loading the board…' : "This board hasn't been opened on this device yet. Connect to load it."}</p>
    {:else}
      <div class="lanes" bind:this={scroller} {@attach attachDrag}>
        {#each b.columns as col (col.id)}
          <Lane {col} {b} cards={b.cardsIn(col.id).filter(keep)} {filtered} onmenu={() => (menuFor = col.id)} />
        {/each}
        {#if b.orphans.length}
          <section class="lane-x">
            <p class="label">Cards from a removed column</p>
            {#each b.orphans as c (c.id)}
              <button class="btn" onclick={() => app.openCard(id, c.id)}>{c.title || 'Untitled'}</button>
            {/each}
          </section>
        {/if}
        <div class="new-col">
          {#if addingCol}
            <form onsubmit={addColumn}>
              <input
                class="field"
                placeholder={b.columns.length ? `Campaign ${b.columns.length + 1}` : 'Campaign 1'}
                aria-label="Column name"
                maxlength="100"
                bind:value={colName}
                {@attach (el: HTMLInputElement) => el.focus()}
                onkeydown={(e) => e.key === 'Escape' && (addingCol = false)}
              />
              <div class="row">
                <button class="key ink" type="submit" disabled={!colName.trim()}>Add column</button>
                <button class="btn ghost" type="button" onclick={() => (addingCol = false)}>Cancel</button>
              </div>
            </form>
          {:else}
            <button class="add-col" onclick={() => (addingCol = true)}><Icon name="plus" /> Add a column</button>
            {#if !b.columns.length}
              <p class="hint">Columns group cards however suits the project, like Campaign 1 and Campaign 2. Each card has its own status.</p>
            {/if}
          {/if}
        </div>
      </div>
    {/if}
  </div>
  {#if menuFor}
    <ColumnMenu board={id} colId={menuFor} onclose={() => (menuFor = null)} />
  {/if}
{/if}

<style>
  .screen {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    padding-top: env(safe-area-inset-top);
    padding-bottom: calc(var(--bar-h) + env(safe-area-inset-bottom));
  }
  @media (min-width: 768px) {
    .screen {
      height: calc(100dvh - 56px);
      padding-bottom: 0;
      padding-top: 0;
    }
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px max(8px, env(safe-area-inset-right)) 0 max(4px, env(safe-area-inset-left));
  }
  @media (min-width: 768px) {
    .head {
      padding: 12px var(--px) 0 calc(var(--px) - 8px);
    }
    .back {
      display: none;
    }
  }
  h1 {
    flex: 1;
    min-width: 0;
    margin: 0 0 0 4px;
    font-size: 20px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .mark {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    flex: none;
  }
  .sync {
    font-size: 12px;
    color: var(--faint);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .acts .btn {
    min-height: 40px;
    border: none;
    background: transparent;
  }
  @media (max-width: 480px) {
    .wide {
      display: none;
    }
  }
  .filters {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px max(var(--px), env(safe-area-inset-right)) 8px max(var(--px), env(safe-area-inset-left));
    overflow-x: auto;
    flex: none;
  }
  .sel {
    position: relative;
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--line);
    border-radius: var(--r-ctl);
    background: var(--raised);
    color: var(--muted);
    flex: none;
  }
  .sel.on {
    background: var(--text);
    border-color: var(--text);
    color: var(--bg);
  }
  .sel select {
    appearance: none;
    -webkit-appearance: none;
    border: none;
    background: transparent;
    color: inherit;
    font: 500 13px var(--font);
    min-height: 36px;
    padding: 0 28px 0 12px;
    cursor: pointer;
  }
  .sel :global(svg) {
    position: absolute;
    right: 8px;
    pointer-events: none;
  }
  .sel.on :global(svg path) {
    stroke: currentColor;
  }
  .clear {
    min-height: 36px;
    color: var(--muted);
  }
  .wait {
    padding: 20px var(--px);
    color: var(--muted);
  }
  .lanes {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    padding: 4px max(var(--px), env(safe-area-inset-right)) 14px max(var(--px), env(safe-area-inset-left));
    scroll-snap-type: x proximity;
    scroll-padding: 0 var(--px);
  }
  .lanes > :global(*) {
    max-height: 100%;
  }
  .new-col {
    flex: 0 0 min(84vw, 290px);
    scroll-snap-align: start;
  }
  .new-col form {
    display: grid;
    gap: 8px;
    padding: 8px;
    background: var(--sunk);
    border-radius: var(--r-card);
  }
  .add-col {
    width: 100%;
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    border-radius: var(--r-card);
    border: 1px dashed var(--line);
    background: transparent;
    color: var(--muted);
    font: 500 14px var(--font);
    cursor: pointer;
  }
  .hint {
    color: var(--muted);
    font-size: 13.5px;
    margin: 10px 4px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .lane-x {
    flex: 0 0 260px;
    display: grid;
    gap: 6px;
    padding: 10px;
    border: 1px dashed var(--line);
    border-radius: var(--r-card);
  }
  .lane-x .btn {
    justify-content: flex-start;
  }
  :global(body.dragging) {
    cursor: grabbing;
  }
</style>
