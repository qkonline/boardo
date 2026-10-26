<script lang="ts">
  import { flushSync, onMount } from 'svelte';
  import { statusOption } from '../../shared/rules';
  import { hueColor } from '../lib/hue';
  import { matchBoard, nameMatches, queryWords, highlight, snippet, type Hit } from '../lib/search';
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';

  /**
   * Search across every board (R9.16 to R9.20), like the bell: on a computer a box in the top bar,
   * its results dropping below it (Cmd-K or Ctrl-K from anywhere); on a phone a magnifier beside
   * the bell that opens the box and the results down to the tab bar. Results are grouped by
   * board, matching boards first; a card opens on top and the results stay. It all runs on the
   * device (src/lib/search.ts), so it works offline.
   */
  let { where }: { where: 'bar' | 'head' } = $props();

  let wide = $state(true);
  onMount(() => {
    const mq = matchMedia('(min-width: 768px)');
    const set = () => (wide = mq.matches);
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  });
  const mine = $derived(where === 'bar' ? wide : !wide);
  // A card opened from the results sits on top; the results wait under it (hidden on a phone).
  const open = $derived(app.search.open && mine && !(where === 'head' && app.open));

  let input = $state<HTMLInputElement | null>(null);
  let key = $state<HTMLButtonElement | null>(null);
  /** On a phone the results start just below the magnifier. */
  let top = $state(0);

  const words = $derived(queryWords(app.search.q));
  const PER_BOARD = 5;
  let more = $state<Set<string>>(new Set());
  let active = $state<string | null>(null);

  type Group = { id: string; name: string; hue: string; hits: Hit[] };
  const result = $derived.by(() => {
    if (!words.length) return null;
    const groups: Group[] = [];
    for (const item of app.boards) {
      const b = app.data[item.id];
      if (!b?.loaded) continue;
      const hits = matchBoard(b, words);
      if (hits.length) groups.push({ id: item.id, name: b.board?.name ?? item.name, hue: b.board?.hue ?? item.hue, hits });
    }
    // Boards with the best match first; the board on screen first of all.
    const here = 'id' in app.screen ? app.screen.id : null;
    const rank = (h: Hit) => [Number(h.card.archived), -h.score, -h.at];
    groups.sort((a, b) => {
      if (a.id === here || b.id === here) return a.id === here ? -1 : 1;
      const x = rank(a.hits[0]);
      const y = rank(b.hits[0]);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
    const boards = app.boards.filter((x) => nameMatches(app.data[x.id]?.board?.name ?? x.name, words)).slice(0, 3);
    const cards = groups.reduce((n, g) => n + g.hits.length, 0);
    return { groups, boards, cards };
  });
  const unloaded = $derived(app.boards.filter((x) => !app.data[x.id]?.loaded).length);

  /** Everything the arrows move through, in order. */
  const options = $derived.by(() => {
    if (!result) return [] as string[];
    const ids = result.boards.map((x) => `b:${x.id}`);
    for (const g of result.groups) for (const h of g.hits.slice(0, more.has(g.id) ? undefined : PER_BOARD)) ids.push(`c:${g.id}:${h.card.id}`);
    return ids;
  });
  const optId = (o: string) => `search-${o.replace(/[^A-Za-z0-9_-]/g, '-')}`;

  // A polite count for screen readers, once typing stops.
  let said = $state('');
  $effect(() => {
    const text = !words.length ? '' : !result?.cards ? 'No cards match' : `${result.cards} ${result.cards === 1 ? 'card matches' : 'cards match'}`;
    const t = setTimeout(() => (said = text), 500);
    return () => clearTimeout(t);
  });

  function show() {
    if (!wide && key) top = key.getBoundingClientRect().bottom + 6;
    // Shown and focused in the same tap: iOS only opens the keyboard then.
    flushSync(() => (app.search.open = true));
    input?.focus();
  }
  function hide(back = true) {
    app.search.open = false;
    active = null;
    if (back) (wide ? input : key)?.focus();
    else input?.blur();
  }
  function type(v: string) {
    app.search.q = v;
    more = new Set();
    active = null;
    if (!app.search.open) app.search.open = true;
  }
  function choose(o: string) {
    const [kind, board, card] = o.split(':');
    if (kind === 'b') {
      hide(false);
      app.go({ name: 'board', id: board });
    } else app.openCard(board, card);
  }
  function openBoard(id: string) {
    // The board opens searched for the same words (R3.6a).
    const f = app.boardFilters[id] ?? { person: 'all', status: 'all', q: '' };
    app.boardFilters[id] = { ...f, q: app.search.q };
    hide(false);
    app.go({ name: 'board', id });
  }
  function keys(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (app.search.q) type('');
      else hide();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      const i = active ? options.indexOf(active) : -1;
      const j = e.key === 'ArrowDown' ? Math.min(options.length - 1, i + 1) : Math.max(0, i - 1);
      active = options[j];
      document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = active ?? options[0];
      if (o) choose(o);
    }
  }
  // Cmd-K or Ctrl-K from anywhere (a computer), unless a card or a sheet is open.
  function shortcut(e: KeyboardEvent) {
    if (!mine || !wide || e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (app.open || app.sheet) return;
    e.preventDefault();
    show();
    input?.select();
  }

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const meta = (g: Group, h: Hit) => {
    const b = app.data[g.id];
    const col = b?.column.get(h.card.columnId)?.name;
    const st = b ? statusOption(h.card, b.statusField)?.label : undefined;
    return [col, st].filter(Boolean).join(' · ');
  };
</script>

<svelte:window onkeydown={shortcut} />

<span class="search {where}" class:open>
  {#if where === 'bar'}
    <label class="box" class:on={open}>
      <Icon name="search" size={16} />
      <span class="sr-only">Search all boards</span>
      <input
        bind:this={input}
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        placeholder="Search all boards"
        role="combobox"
        aria-expanded={open}
        aria-controls="search-results-{where}"
        aria-activedescendant={active ? optId(active) : undefined}
        value={app.search.q}
        onfocus={() => (app.search.open = true)}
        oninput={(e) => type(e.currentTarget.value)}
        onkeydown={keys}
      />
      {#if !app.search.q}<kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>{/if}
    </label>
  {:else}
    <button bind:this={key} class="icon-btn" class:on={open} aria-label="Search all boards" aria-expanded={open} onclick={() => (open ? hide() : show())}
      ><Icon name="search" size={22} /></button
    >
  {/if}

  {#if open}
    <button class="catch" aria-label="Close search" tabindex="-1" onclick={() => hide(false)}></button>
    <section class="list" style:--top="{top}px" aria-label="Search">
      {#if where === 'head'}
        <div class="field-row">
          <label class="box on">
            <Icon name="search" size={16} />
            <span class="sr-only">Search all boards</span>
            <input
              bind:this={input}
              type="search"
              enterkeyhint="search"
              autocomplete="off"
              placeholder="Search all boards"
              role="combobox"
              aria-expanded="true"
              aria-controls="search-results-{where}"
              aria-activedescendant={active ? optId(active) : undefined}
              value={app.search.q}
              oninput={(e) => type(e.currentTarget.value)}
              onkeydown={keys}
            />
          </label>
          <button class="btn ghost" onclick={() => hide()}>Done</button>
        </div>
      {/if}
      <div id="search-results-{where}" role="listbox" aria-label="Results">
        {#if !result}
          <p class="empty">Find cards by their title, description, comments, fields or files.</p>
        {:else}
          {#if result.cards || result.boards.length}
            <p class="sum">
              {result.cards === 1 ? '1 card' : `${result.cards || 'No'} cards`}{result.groups.length > 1 ? ` in ${result.groups.length} boards` : ''}
            </p>
          {/if}
          {#if result.boards.length}
            <div role="group" aria-label="Boards" class="group">
              <h3 class="g-head"><span>Boards</span></h3>
              {#each result.boards as x (x.id)}
                {@const o = `b:${x.id}`}
                <button id={optId(o)} role="option" aria-selected={active === o} class="row board" class:active={active === o} onclick={() => choose(o)}>
                  <span class="sq" style:background={hueColor(app.data[x.id]?.board?.hue ?? x.hue)}></span>
                  <span class="t">{#each highlight(app.data[x.id]?.board?.name ?? x.name, words) as p, i (i)}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span>
                </button>
              {/each}
            </div>
          {/if}
          {#each result.groups as g (g.id)}
            <div role="group" aria-label={g.name} class="group">
              <h3 class="g-head">
                <span class="sq" style:background={hueColor(g.hue)}></span>
                <span>{g.name}</span>
                <span class="n">{g.hits.length}</span>
                <button class="link" onclick={() => openBoard(g.id)}>Open board</button>
              </h3>
              {#each g.hits.slice(0, more.has(g.id) ? undefined : PER_BOARD) as h (h.card.id)}
                {@const o = `c:${g.id}:${h.card.id}`}
                {@const m = meta(g, h)}
                <button
                  id={optId(o)}
                  role="option"
                  aria-selected={active === o}
                  class="row"
                  class:active={active === o}
                  onclick={() => choose(o)}
                >
                  <span class="t">{#each highlight(h.card.title || 'Untitled', words) as p, i (i)}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span>
                  {#if h.part && !nameMatches(h.card.title, words)}
                    <span class="part"
                      >{#if h.part.where !== 'desc'}<span class="where">{h.part.where === 'comment' ? h.part.label.replace(/^Comment by /, '') : h.part.label}:</span>{' '}{/if}{#each snippet(h.part.text, words, 110) as p, i (i)}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span
                    >
                  {/if}
                  {#if m || h.card.archived}
                    <span class="meta">{m}{#if h.card.archived}<span class="tag">Archived</span>{/if}</span>
                  {/if}
                </button>
              {/each}
              {#if g.hits.length > PER_BOARD && !more.has(g.id)}
                <button class="link more" onclick={() => (more = new Set([...more, g.id]))}>Show {g.hits.length - PER_BOARD} more</button>
              {/if}
            </div>
          {/each}
          {#if !result.cards && !result.boards.length}
            <p class="empty">No cards match.</p>
          {/if}
        {/if}
        {#if result && unloaded}
          <p class="note">
            {app.online
              ? `${unloaded === 1 ? "1 board hasn't" : `${unloaded} boards haven't`} loaded yet, so ${unloaded === 1 ? "it isn't" : "they aren't"} searched.`
              : `${unloaded === 1 ? "1 board hasn't" : `${unloaded} boards haven't`} loaded on this device yet. Connect to load ${unloaded === 1 ? 'it' : 'them'}.`}
          </p>
        {/if}
      </div>
    </section>
  {/if}
  <span class="sr-only" aria-live="polite">{open ? said : ''}</span>
</span>

<style>
  .search {
    position: relative;
    display: inline-flex;
  }
  /* The one for the other screen size stays out of sight. */
  .bar {
    display: none;
  }
  @media (min-width: 768px) {
    .bar {
      display: inline-flex;
    }
    .head {
      display: none;
    }
  }
  .box {
    position: relative;
    z-index: 42;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 0 10px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: var(--r-ctl);
    background: var(--sunk);
    color: var(--muted);
    cursor: text;
  }
  .bar .box {
    width: 300px;
  }
  .box.on,
  .box:focus-within {
    border-color: var(--accent);
    background: var(--raised);
  }
  .box input {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font: 500 14px var(--font);
  }
  .box input::placeholder {
    color: var(--muted);
  }
  kbd {
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--raised);
    color: var(--muted);
    font: 500 11.5px var(--font);
  }
  .icon-btn.on {
    background: var(--tint-indigo);
  }
  .catch {
    position: fixed;
    inset: 0;
    z-index: 40;
    border: none;
    background: transparent;
    cursor: default;
  }
  .list {
    z-index: 41;
    background: var(--raised);
    overflow-y: auto;
    overscroll-behavior: contain;
    text-align: left;
    color: var(--text);
  }
  .bar .list {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 560px;
    max-height: calc(100dvh - 84px);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    box-shadow:
      0 18px 48px rgba(22, 24, 29, 0.16),
      0 2px 6px rgba(22, 24, 29, 0.06);
    animation: drop 140ms ease-out;
  }
  .head .list {
    position: fixed;
    top: var(--top);
    left: 0;
    right: 0;
    bottom: calc(var(--bar-h) + env(safe-area-inset-bottom));
    border-radius: var(--r-card) var(--r-card) 0 0;
    box-shadow:
      0 -1px 0 var(--border),
      0 12px 32px rgba(22, 24, 29, 0.12);
    animation: drop 160ms ease-out;
  }
  @keyframes drop {
    from {
      opacity: 0;
      translate: 0 -6px;
    }
  }
  .field-row {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 8px 8px 16px;
    background: var(--raised);
  }
  .field-row .box {
    flex: 1;
    min-height: 44px;
  }
  .empty,
  .note,
  .sum {
    margin: 0;
    padding: 14px 16px;
    color: var(--muted);
    font-size: 14px;
  }
  .sum {
    padding: 12px 16px 4px;
    font-size: 12.5px;
  }
  .note {
    padding-top: 6px;
    font-size: 13px;
  }
  .group {
    padding: 4px 0 8px;
  }
  .group + .group {
    border-top: 1px solid var(--border);
  }
  .g-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 8px 4px 16px;
    font: 600 13px var(--font);
    color: var(--muted);
  }
  .g-head .n {
    font-weight: 500;
  }
  .sq {
    width: 10px;
    height: 10px;
    flex: none;
    border-radius: 3px;
  }
  .link {
    margin-left: auto;
    min-height: 32px;
    padding: 0 8px;
    border: none;
    background: none;
    color: var(--t-indigo);
    font: 500 13px var(--font);
    cursor: pointer;
  }
  .link.more {
    margin: 2px 0 0 8px;
  }
  .row {
    display: grid;
    gap: 2px;
    width: calc(100% - 16px);
    margin: 0 8px;
    padding: 8px;
    border: none;
    border-radius: var(--r-ctl);
    background: none;
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .row.board {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .row.active,
  .row:focus-visible {
    background: var(--sunk);
    outline: none;
  }
  @media (hover: hover) {
    .row:hover {
      background: var(--sunk);
    }
  }
  .row .t {
    font-weight: 600;
    font-size: 14.5px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .part {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .part .where {
    color: var(--text);
    font-weight: 500;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--faint);
    font-size: 12px;
  }
  .tag {
    padding: 1px 6px;
    border-radius: var(--r-sm);
    background: var(--sunk);
    color: var(--muted);
    font-weight: 500;
  }
  mark {
    padding: 0 1px;
    margin: 0 -1px;
    border-radius: 2px;
    background: color-mix(in oklab, var(--accent) 30%, transparent);
    color: inherit;
  }
</style>
