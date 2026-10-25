<script lang="ts">
  import type { LogRec } from '../../shared/model';
  import { dayName, when } from '../lib/dates';
  import { feed, type Run, span } from '../lib/feed';
  import { hueColor } from '../lib/hue';
  import { logText, logTone } from '../lib/logtext';
  import { app } from '../lib/store.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import PersonLink from './PersonLink.svelte';
  import Sheet from './Sheet.svelte';

  /**
   * The project log (R6.3), in a panel that slides in from the right over the board. It reads as
   * a feed (feed.ts): by day; one person's changes made close together under their name once;
   * within those, a card's changes under its name once, which opens it (stacked on top). The
   * latest 40 show, and Load more brings the next 40.
   */
  let { id }: { id: string } = $props();
  const b = $derived(app.data[id]);
  const PAGE = 40;
  let person = $state('all');
  let card = $state('all');
  let limit = $state(PAGE);

  const cards = $derived(
    b ? [...b.card.values()].filter((c) => b.logs.some((l) => l.cardId === c.id)).sort((x, y) => x.title.localeCompare(y.title)) : [],
  );
  const logs = $derived(
    b
      ? b.logs.filter(
          (l) =>
            (person === 'all' || l.userId === person || l.detail.user === person) &&
            (card === 'all' || (card === 'board' ? !l.cardId : l.cardId === card)),
        )
      : [],
  );
  // A new filter starts from the latest again.
  $effect(() => {
    void person;
    void card;
    limit = PAGE;
  });
  const days = $derived(feed(logs.slice(0, limit)));
  const personName = $derived(person === 'all' ? 'Everyone' : (b?.member.get(person)?.name ?? 'Someone'));
  const cardName = $derived(card === 'all' ? 'Every card' : card === 'board' ? 'The board' : (b?.card.get(card)?.title || 'Untitled'));
  const close = () => (app.activity = null);

  type Item = { kind: 'card'; g: Run['cards'][number] } | { kind: 'adds'; key: string; column: string; ids: string[]; tone: string };
  /**
   * A run's card groups, with new cards added one after another to the same column folded into
   * one line ("added 12 cards to Marketing") instead of a name and a line for each.
   */
  function items(r: Run): Item[] {
    const out: Item[] = [];
    for (const g of r.cards) {
      const l = g.logs[0];
      const add = g.cardId && g.logs.length === 1 && l.action === 'created' ? String(l.detail.column ?? '') : null;
      const last = out.at(-1);
      if (add != null && last?.kind === 'adds' && last.column === add) last.ids.push(g.cardId!);
      else if (add != null) out.push({ kind: 'adds', key: g.cardId!, column: add, ids: [g.cardId!], tone: logTone(l, b) });
      else out.push({ kind: 'card', g });
    }
    // One new card alone reads better as itself.
    return out.map((it) => (it.kind === 'adds' && it.ids.length === 1 ? { kind: 'card', g: r.cards.find((g) => g.cardId === it.ids[0])! } : it));
  }
  /** Folded adds showing all their names, not just the first few. */
  let opened = $state(new Set<string>());
  const FEW = 6;

  /** A card's name for its changes: still there (opens it), or as it was when deleted. */
  function cardTitle(cardId: string): string {
    const c = b.card.get(cardId);
    if (c) return c.title || 'Untitled';
    const gone = b.logs.find((l) => l.cardId === cardId && l.action === 'deleted');
    return gone ? String(gone.detail.title || 'Untitled') : 'A deleted card';
  }
  /**
   * One change, said after the person's name and under its card's: "set Severity to Critical",
   * "commented", "renamed it from …". The card's name is right above, so "this card" goes.
   */
  function line(l: LogRec): string {
    if (l.action === 'member_added' && (!l.userId || l.userId === l.detail.user)) return 'joined the board';
    let t = logText(l, b, !!l.cardId);
    if (!l.cardId) return t;
    t = t.replace(/^This card /, '').replace(/ on this card$/, '').replace(/\bthis card\b/g, 'it').replace(/\bits (status|description)\b/g, 'the $1');
    return t;
  }
</script>

<Sheet variant="side" label="Activity" onclose={close}>
  {#if b}
    <div class="top">
      <div>
        <p class="crumb"><span class="mark" style:background={hueColor(b.board?.hue)}></span>{b.board?.name}</p>
        <h2>Activity</h2>
      </div>
      <button class="icon-btn" aria-label="Close" onclick={close}><Icon name="close" /></button>
    </div>
    <div class="filters">
      <Icon name="filter" />
      <label class="sel" class:on={person !== 'all'}>
        <span class="sr-only">Person</span>
        <span class="val">{personName}</span>
        <select bind:value={person}>
          <option value="all">Everyone</option>
          {#each b.members as m (m.userId)}<option value={m.userId}>{m.name}</option>{/each}
        </select>
        <Icon name="down" size={14} />
      </label>
      <label class="sel" class:on={card !== 'all'}>
        <span class="sr-only">Card</span>
        <span class="val">{cardName}</span>
        <select bind:value={card}>
          <option value="all">Every card</option>
          <option value="board">The board</option>
          {#each cards as c (c.id)}<option value={c.id}>{c.title || 'Untitled'}</option>{/each}
        </select>
        <Icon name="down" size={14} />
      </label>
    </div>

    <div class="scroll">
      {#if !logs.length}
        <p class="none">{b.logs.length ? 'Nothing matches these filters.' : 'Nothing yet. Changes to the board and its cards show here.'}</p>
      {/if}
      {#each days as d (d.key)}
        <section class="day" aria-label={dayName(d.key)}>
          <h3>{dayName(d.key)}</h3>
          {#each d.runs as r (r.id)}
            {@const who = r.userId ? b.member.get(r.userId) : null}
            <article class="run">
              <div class="face">
                {#if r.userId}
                  <PersonLink person={who} {b}><Avatar person={who} size={28} /></PersonLink>
                {:else}
                  <span class="auto" aria-hidden="true">B</span>
                {/if}
              </div>
              <div class="body">
                <header>
                  <b>{r.userId ? (who?.name ?? 'Someone who left') : 'Boardo'}</b>
                  <time datetime={new Date(r.newest).toISOString()}>{span(r)}</time>
                </header>
                {#each items(r) as it (it.kind === 'adds' ? `adds-${it.key}` : (it.g.cardId ?? '_board'))}
                  {#if it.kind === 'adds'}
                    {@const all = opened.has(it.key) ? it.ids : it.ids.slice(0, FEW)}
                    <div class="group">
                      <ul>
                        <li style:--tone={it.tone}>added {it.ids.length} cards{it.column ? ` to ${it.column}` : ''}</li>
                      </ul>
                      <p class="adds">
                        {#each all as cid, i (cid)}{#if b.card.has(cid)}<button class="card mini" onclick={() => app.openCard(b.id, cid)}
                              >{cardTitle(cid)}</button
                            >{:else}<span class="card mini gone">{cardTitle(cid)}</span>{/if}{#if i < all.length - 1}<span class="sep">{', '}</span>{/if}{/each}
                        {#if all.length < it.ids.length}
                          <button class="few" onclick={() => (opened = new Set([...opened, it.key]))}>and {it.ids.length - all.length} more</button>
                        {/if}
                      </p>
                    </div>
                  {:else}
                  {@const g = it.g}
                  <div class="group">
                    {#if g.cardId}
                      {#if b.card.has(g.cardId)}
                        <button class="card" onclick={() => app.openCard(b.id, g.cardId!)}
                          ><span>{cardTitle(g.cardId)}</span><Icon name="right" size={12} plain /></button
                        >
                      {:else}
                        <span class="card gone">{cardTitle(g.cardId)}</span>
                      {/if}
                    {:else if r.cards.length > 1}
                      <span class="card board">The board</span>
                    {/if}
                    <ul>
                      {#each g.logs as l (l.id)}
                        <li style:--tone={logTone(l, b)} title={when(l.at)}>{line(l)}</li>
                      {/each}
                    </ul>
                  </div>
                  {/if}
                {/each}
              </div>
            </article>
          {/each}
        </section>
      {/each}
      {#if logs.length > limit}
        <div class="more">
          <button class="btn" onclick={() => (limit += PAGE)}>Load more</button>
          <span>{limit} of {logs.length}</span>
        </div>
      {/if}
    </div>
  {/if}
</Sheet>

<style>
  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 14px 8px 0 20px;
    flex: none;
  }
  .crumb {
    margin: 0;
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--muted);
    font-size: 13px;
  }
  .mark {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex: none;
  }
  h2 {
    margin: 2px 0 0;
    font-size: 21px;
    font-weight: 600;
  }

  /* The filters, as quiet as the board's own. */
  .filters {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 12px 8px 20px;
    flex: none;
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }
  .filters > :global(svg) {
    margin-right: 2px;
    flex: none;
  }
  .sel {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-width: 0;
    border-radius: var(--r-ctl);
    color: var(--muted);
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
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 170px;
  }
  .sel.on .val {
    font-weight: 600;
  }
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

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 20px max(24px, env(safe-area-inset-bottom));
  }
  .none {
    color: var(--muted);
    font-size: 14px;
    margin: 18px 0;
  }

  /* A day: its name stays at the top while its changes scroll under it. */
  .day h3 {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0;
    padding: 16px 0 8px;
    background: var(--bg);
    font: 600 13px/1 var(--font);
    color: var(--muted);
  }

  /* One person's run: their face beside it, their name and time once, then what they did. */
  .run {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 12px;
    padding: 6px 0 16px;
  }
  .run + .run {
    border-top: 1px solid var(--border);
    padding-top: 14px;
  }
  .face :global(.plink) {
    border-radius: var(--r-ctl);
  }
  .auto {
    width: 28px;
    height: 28px;
    border-radius: var(--r-ctl);
    display: grid;
    place-items: center;
    font: 600 12px var(--font);
    color: var(--bg);
    background: linear-gradient(135deg, var(--stripe));
  }
  .body {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    min-height: 28px;
    align-content: center;
    flex-wrap: wrap;
  }
  header b {
    font: 600 14.5px/28px var(--font);
  }
  time {
    color: var(--faint);
    font-size: 12.5px;
    white-space: nowrap;
  }

  /* A card's changes under its name, which opens it. */
  .group {
    display: grid;
    gap: 4px;
  }
  .card {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    padding: 2px 6px;
    margin-left: -6px;
    border: none;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text);
    font: 600 13.5px/1.35 var(--font);
    text-align: left;
    cursor: pointer;
  }
  .card span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card :global(svg) {
    flex: none;
    color: var(--faint);
  }
  @media (hover: hover) {
    button.card:hover {
      background: var(--sunk);
    }
  }
  .card.gone {
    cursor: default;
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: var(--faint);
  }
  .card.board {
    cursor: default;
    color: var(--muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 3px;
  }
  li {
    position: relative;
    padding-left: 14px;
    font-size: 14px;
    line-height: 1.45;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  /* Each change's point, in the colour of its kind, as on a card's History. */
  li::before {
    content: '';
    position: absolute;
    left: 1px;
    top: 0.62em;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--tone);
  }

  /* New cards folded into one line: their names after it, each opening its card. */
  .adds {
    margin: 0;
    padding-left: 14px;
    font-size: 13.5px;
    line-height: 1.6;
  }
  .card.mini {
    margin-left: 0;
    padding: 0;
    border-radius: 0;
    font: 500 13.5px/1.6 var(--font);
    color: var(--text);
  }
  @media (hover: hover) {
    button.card.mini:hover {
      background: none;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  }
  .card.mini.gone {
    color: var(--muted);
  }
  .sep {
    color: var(--faint);
  }
  .few {
    border: none;
    background: none;
    padding: 0 0 0 6px;
    color: var(--t-indigo);
    font: 500 13.5px/1.6 var(--font);
    cursor: pointer;
  }
  .more {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 0 8px;
  }
  .more span {
    color: var(--faint);
    font-size: 13px;
  }
</style>
