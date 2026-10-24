<script lang="ts">
  import Bell from './Bell.svelte';
  import type { CardRec } from '../../shared/model';
  import { bgImage, boardBackground } from '../lib/background';
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
  // What each filter shows: the chosen option's text, so the control is as wide as that.
  const personLabel = $derived(
    f.person === 'all'
      ? 'Everyone'
      : f.person === 'none'
        ? 'Nobody yet'
        : f.person === app.user?.id
          ? 'Me'
          : (b?.member.get(f.person)?.name ?? 'Everyone'),
  );
  const statusLabel = $derived(
    f.status === 'all'
      ? 'All statuses'
      : f.status === 'none'
        ? 'No status'
        : (b?.statusField?.options?.find((o) => o.id === f.status)?.label ?? 'All statuses'),
  );

  function keep(c: CardRec): boolean {
    if (f.person === 'none' && c.assignees.length) return false;
    if (f.person !== 'all' && f.person !== 'none' && !c.assignees.includes(f.person)) return false;
    if (f.status !== 'all' && (c.values.status ?? 'none') !== f.status) return false;
    return true;
  }

  // The board's background (admins set it in board settings): a colour, or an image by link.
  const bgId = $derived(bgImage(b?.board));
  $effect(() => {
    if (bgId && app.online) void app.files.ensure(id, [bgId]);
  });
  const background = $derived(boardBackground(b?.board, bgId ? app.files.links[bgId]?.url : undefined));

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
  <div class="screen" class:has-bg={!!b.board?.background} class:has-image={!!bgId} style:background>
    <header class="head">
      <button class="icon-btn back" aria-label="Boards" onclick={() => app.go({ name: 'home' })}><Icon name="back" /></button>
      <h1><span class="mark" style:background={hueColor(b.board?.hue ?? item.hue)}></span><span class="name">{b.board?.name ?? item.name}</span></h1>
      <div class="filters">
        <Icon name="filter" />
        <label class="sel" class:on={f.person !== 'all'}>
          <span class="sr-only">Person</span>
          <span class="val">{personLabel}</span>
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
          <span class="val">{statusLabel}</span>
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
      {#if b.status !== 'live' && app.online && b.loaded}
        <span class="sync" title="Connecting">Connecting</span>
      {/if}
      <div class="acts">
        <button class="btn" onclick={() => (app.activity = id)}><Icon name="log" /><span class="wide">Activity</span></button>
        <button class="icon-btn" aria-label="Board settings" onclick={() => app.go({ name: 'boardSettings', id })}
          ><Icon name="gear" /></button
        >
        <Bell where="head" />
      </div>
    </header>


    {#if !b.loaded}
      <p class="wait">
        {!app.online
          ? "This board hasn't been opened on this device yet. Connect to load it."
          : b.status === 'offline'
            ? "Can't reach this board right now. Trying again…"
            : 'Loading the board…'}
      </p>
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
  /* Over a background image, the header gets a frosted strip so its words stay readable. */
  .has-image .head {
    background: color-mix(in oklab, var(--bg) 72%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .has-image .lanes :global(.lane) {
    background: color-mix(in oklab, var(--sunk) 88%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
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
    padding: 6px max(8px, env(safe-area-inset-right)) 12px max(4px, env(safe-area-inset-left));
  }
  @media (min-width: 768px) {
    /* Even above and below, and the name lined up with the columns and the logo. */
    .head {
      padding: 10px calc(var(--px) - 8px) 10px var(--px);
    }
    .back {
      display: none;
    }
    .head h1 {
      margin-left: 0;
    }
  }
  h1 {
    flex: 0 1 auto;
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
    margin-left: auto;
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
  /* The filters sit in the header beside the board's name, quiet until one is on. */
  .filters {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: 28px;
    min-width: 0;
    flex: 0 1 auto;
  }
  .filters > :global(svg) {
    margin-right: 2px;
  }
  .sel {
    position: relative;
    display: inline-flex;
    align-items: center;
    border-radius: var(--r-ctl);
    color: var(--muted);
    flex: none;
  }
  @media (hover: hover) {
    .sel:hover {
      background: var(--sunk);
    }
  }
  .sel.on {
    color: var(--accent);
  }
  .val {
    font: 500 14px var(--font);
    min-height: var(--btn);
    display: inline-flex;
    align-items: center;
    padding: 0 24px 0 8px;
    white-space: nowrap;
  }
  .sel.on .val {
    font-weight: 600;
  }
  /* The real select lies over the text, invisible: a tap opens the system menu. */
  .sel select {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    appearance: none;
    -webkit-appearance: none;
    border: none;
    cursor: pointer;
  }
  .sel:has(select:focus-visible) {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
  .sel :global(svg) {
    position: absolute;
    right: 6px;
    pointer-events: none;
  }
  .clear {
    min-height: var(--btn);
    padding: 0 8px;
    color: var(--muted);
    font-size: 13px;
  }
  /* On a phone the filters drop below the name. */
  @media (max-width: 640px) {
    .head {
      flex-wrap: wrap;
    }
    h1 {
      flex: 1 1 0;
    }
    h1 .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .filters {
      order: 5;
      flex-basis: 100%;
      margin: 0 0 0 calc(var(--px) - 4px);
      overflow-x: auto;
    }
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
  /* Below the frosted strip, the columns sit as far from it as from the left edge. */
  .has-image .lanes {
    padding-top: var(--px);
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
