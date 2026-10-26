<script lang="ts">
  import { flushSync } from 'svelte';
  import { sameNamed } from '../../shared/rules';
  import Bell from './Bell.svelte';
  import type { CardRec } from '../../shared/model';
  import { bgImage, boardBackground } from '../lib/background';
  import { drag } from '../lib/drag.svelte';
  import { hueColor } from '../lib/hue';
  import { matchBoard, queryWords } from '../lib/search';
  import { app } from '../lib/store.svelte';
  import ColumnMenu from './ColumnMenu.svelte';
  import Icon from './Icon.svelte';
  import Lane from './Lane.svelte';

  let { id }: { id: string } = $props();
  const b = $derived(app.data[id]);
  const item = $derived(app.boards.find((x) => x.id === id));

  // Filters (R3.6) and search (R3.6a), kept per board in the store while the app is open.
  const NONE = { person: 'all', status: 'all', q: '' };
  const f = $derived(app.boardFilters[id] ?? NONE);
  const setFilter = (k: 'person' | 'status' | 'q', v: string) => (app.boardFilters[id] = { ...f, [k]: v });
  const words = $derived(queryWords(f.q));
  const filtered = $derived(f.person !== 'all' || f.status !== 'all' || words.length > 0);
  /** The cards with every word, and where each matched (src/lib/search.ts). */
  const found = $derived(b && words.length ? new Map(matchBoard(b, words).map((h) => [h.card.id, h])) : null);
  const archivedFound = $derived(found ? [...found.values()].filter((h) => h.card.archived).length : 0);
  const shownCount = $derived(b ? b.columns.reduce((n, c) => n + b.cardsIn(c.id).filter(keep).length, 0) : 0);
  // On a phone the search is a magnifier that opens the box, focused in the same tap (iOS opens
  // the keyboard only then).
  let finding = $state(false);
  let findInput = $state<HTMLInputElement | null>(null);
  function openFind() {
    flushSync(() => (finding = true));
    findInput?.focus();
  }
  function closeFind() {
    finding = false;
    findInput?.blur();
  }
  function findKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    setFilter('q', '');
    closeFind();
  }
  // "/" goes to this board's search, when nothing else has the keys.
  function slash(e: KeyboardEvent) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]') || app.open || app.sheet || document.querySelector('[role=dialog]')) return;
    e.preventDefault();
    openFind();
  }
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
    if (found && !found.has(c.id)) return false;
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
  // An admin's choice (R3.1a): columns as long as their cards, and the whole page scrolls.
  const tall = $derived(!!b?.board?.pageScroll);

  /** A column already called what's being typed. */
  const clash = $derived(sameNamed(b?.columns ?? [], colName));
  async function addColumn(e?: Event) {
    e?.preventDefault();
    const n = colName.trim();
    if (!n || clash) return;
    colName = '';
    await app.addColumn(id, n);
    queueMicrotask(() => scroller?.scrollTo({ left: scroller.scrollWidth, behavior: 'smooth' }));
  }

  function dropped(card: string, d: { column: string; index: number }) {
    // Between the cards it was dropped between: the ones shown, with filters or search on.
    const list = b.cardsIn(d.column).filter((c) => c.id !== card && keep(c));
    void app.moveCard(id, card, d.column, list[d.index - 1]?.id ?? null, list[d.index]?.id ?? null);
  }

  const attachDrag = (el: HTMLElement) => drag.attach(el, () => scroller, dropped);
</script>

<svelte:window onkeydown={slash} />

{#if b && item}
  <div
    class="screen"
    class:tall
    class:has-bg={!!b.board?.background}
    class:has-image={!!bgId}
    style:background={tall && bgId ? undefined : background}
  >
    <!-- With the whole page scrolling, an image stays put behind it at the window's size. -->
    {#if tall && bgId && background}<div class="backdrop" style:background></div>{/if}
    <header class="head" data-board-head>
      <button class="icon-btn back" aria-label="Boards" onclick={() => app.go({ name: 'home' })}><Icon name="back" /></button>
      <h1><span class="mark" style:background={hueColor(b.board?.hue ?? item.hue)}></span><span class="name">{b.board?.name ?? item.name}</span></h1>
      <div class="filters" class:finding>
        <label class="find" class:on={!!f.q}>
          <Icon name="search" size={16} />
          <span class="sr-only">Search this board</span>
          <input
            bind:this={findInput}
            type="search"
            enterkeyhint="search"
            placeholder="Search this board"
            autocomplete="off"
            value={f.q}
            oninput={(e) => setFilter('q', e.currentTarget.value)}
            onkeydown={findKey}
          />
          {#if words.length}<span class="count" aria-live="polite">{shownCount === 1 ? '1 card' : `${shownCount || 'No'} cards`}</span>{/if}
        </label>
        <button class="icon-btn find-key" class:on={!!f.q} aria-label="Search this board" onclick={openFind}
          ><Icon name="search" />{#if f.q}<span class="q">{f.q}</span>{/if}</button
        >
        <button class="btn ghost find-done" onclick={closeFind}>Done</button>
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
          <button class="btn ghost clear" onclick={() => (app.boardFilters[id] = { ...NONE })}>Clear</button>
        {/if}
        <!-- The archived cards, in a panel like Activity. -->
        <button class="arch" onclick={() => ((app.activity = null), (app.archive = id))}
          ><Icon name="archive" size={16} /> Archived{#if b.archived.length}<span class="n">{b.archived.length}</span>{/if}</button
        >
      </div>
      {#if b.status !== 'live' && app.online && b.loaded}
        <span class="sync" title="Connecting">Connecting</span>
      {/if}
      <div class="acts">
        <button class="btn" onclick={() => ((app.archive = null), (app.activity = id))}><Icon name="log" /><span class="wide">Activity</span></button>
        <button class="icon-btn" aria-label="Board settings" onclick={() => app.go({ name: 'boardSettings', id })}
          ><Icon name="gear" /></button
        >
        <Bell where="head" />
      </div>
    </header>
    {#if archivedFound}
      <!-- Archived cards never show in the columns: the search says when some match. -->
      <button class="arch-found" onclick={() => ((app.archiveQuery = f.q), (app.activity = null), (app.archive = id))}
        >{archivedFound === 1 ? '1 archived card matches' : `${archivedFound} archived cards match`}</button
      >
    {/if}


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
          <Lane {col} {b} cards={b.cardsIn(col.id).filter(keep)} {filtered} {found} {words} onmenu={() => (menuFor = col.id)} />
        {/each}
        {#if b.orphans.length}
          <section class="lane-x">
            <p class="label">Cards from a removed column</p>
            {#each b.orphans as c (c.id)}
              <button class="btn" onclick={() => app.openCard(id, c.id)}>{c.title || 'Untitled'}</button>
            {/each}
          </section>
        {/if}
        <!-- Beside columns it's a slim strip; it opens to the full form. -->
        <div class="new-col" class:slim={!addingCol && b.columns.length > 0}>
          {#if addingCol}
            <form onsubmit={addColumn} {@attach (el: HTMLFormElement) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' })}>
              <input
                class="field"
                placeholder={b.columns.length ? `Campaign ${b.columns.length + 1}` : 'Campaign 1'}
                aria-label="Column name"
                maxlength="100"
                bind:value={colName}
                {@attach (el: HTMLInputElement) => el.focus()}
                onkeydown={(e) => e.key === 'Escape' && (addingCol = false)}
              />
              {#if clash}<p class="err" role="alert">There's already a column called {clash.name}.</p>{/if}
              <div class="row">
                <button class="key ink" type="submit" disabled={!colName.trim() || !!clash}>Add column</button>
                <button class="btn ghost" type="button" onclick={() => (addingCol = false)}>Cancel</button>
              </div>
            </form>
          {:else}
            <button class="add-col" onclick={() => (addingCol = true)}><Icon name="plus" /> <span>Add a column</span></button>
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
  /* The whole page scrolls, not each column (R3.1a); the header stays at the top. */
  .screen.tall {
    height: auto;
    min-height: 100dvh;
    padding-top: 0;
  }
  .tall .head {
    position: sticky;
    top: 0;
    /* Above the columns, below the top bar (its search and bell drop over it). */
    z-index: 4;
    padding-top: calc(6px + env(safe-area-inset-top));
    background: var(--bg);
  }
  @media (min-width: 768px) {
    .screen.tall {
      height: auto;
      min-height: calc(100dvh - 56px);
    }
    .tall .head {
      top: 56px;
      padding-top: 10px;
    }
  }
  .tall .lanes {
    flex: none;
    overflow-y: hidden;
    position: relative;
    z-index: 1;
  }
  .tall .lanes > :global(*),
  .tall .lanes :global(.lane) {
    max-height: none;
  }
  .tall .lanes :global([data-scroll]) {
    overflow: visible;
  }
  .backdrop {
    position: fixed;
    inset: 0;
  }
  .tall.has-bg .head {
    background: color-mix(in oklab, var(--bg) 72%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

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
  /* Add a column sits on the background itself, so over a colour or image it gets the lanes' frosted look. */
  .has-bg .add-col,
  .has-bg .hint {
    background: color-mix(in oklab, var(--sunk) 88%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    border-color: transparent;
    color: var(--text);
  }
  .has-bg .hint {
    padding: 10px 12px;
    margin: 10px 0;
    border-radius: var(--r-card);
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
  /* Search this board (R3.6a): a box before the filters; on a phone a magnifier that opens it. */
  .find {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: 230px;
    min-height: var(--btn);
    margin-right: 12px;
    padding: 0 10px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: var(--r-ctl);
    background: var(--sunk);
    color: var(--muted);
    flex: none;
    cursor: text;
  }
  .find:focus-within {
    border-color: var(--accent);
    background: var(--raised);
  }
  .find input {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font: 500 14px var(--font);
  }
  .find input::placeholder {
    color: var(--muted);
  }
  .find .count {
    flex: none;
    color: var(--muted);
    font-size: 12.5px;
    white-space: nowrap;
  }
  .find-key,
  .find-done {
    display: none;
  }
  .find-key .q {
    max-width: 96px;
    margin-left: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--accent);
    font: 600 13px var(--font);
  }
  .find-key.on {
    width: auto;
    padding: 0 8px;
    display: none;
  }
  @media (max-width: 640px) {
    .find {
      display: none;
    }
    .find-key,
    .find-key.on {
      display: inline-flex;
      align-items: center;
    }
    .finding > :global(:not(.find):not(.find-done)) {
      display: none;
    }
    .finding .find {
      display: inline-flex;
      flex: 1;
      width: auto;
      margin-right: 4px;
    }
    .finding .find-done {
      display: inline-flex;
    }
  }
  /* Archived cards that match: they never show in the columns, so this says so and opens them. */
  .arch-found {
    align-self: flex-start;
    margin: -4px 0 8px max(var(--px), env(safe-area-inset-left));
    padding: 6px 10px;
    border: 0;
    border-radius: var(--r-ctl);
    background: var(--sunk);
    color: var(--accent);
    font: 500 13px var(--font);
    cursor: pointer;
  }
  .has-bg .arch-found {
    background: color-mix(in oklab, var(--sunk) 88%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .clear {
    min-height: var(--btn);
    padding: 0 8px;
    color: var(--muted);
    font-size: 13px;
  }
  .arch {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--btn);
    padding: 0 8px;
    margin-left: 6px;
    border: none;
    border-radius: var(--r-ctl);
    background: none;
    color: var(--muted);
    font: 500 14px var(--font);
    white-space: nowrap;
    cursor: pointer;
  }
  @media (hover: hover) {
    .arch:hover {
      background: var(--sunk);
      color: var(--text);
    }
  }
  .arch .n {
    min-width: 18px;
    padding: 2px 5px;
    box-sizing: border-box;
    border-radius: 9px;
    background: var(--sunk);
    color: var(--muted);
    font: 600 11.5px/14px var(--font);
    text-align: center;
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
  /* Beside columns, Add a column is a strip as wide as a tap target, its words running down it. */
  .new-col.slim {
    flex: 0 0 44px;
    scroll-snap-align: end;
  }
  .slim .add-col {
    flex-direction: column;
    gap: 10px;
    /* The plus level with the columns' names; even above and below. */
    padding: 14px 0;
  }
  .slim .add-col span {
    writing-mode: vertical-rl;
  }
  .new-col .err {
    margin: 0;
    color: var(--redT);
    font-size: 13px;
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
