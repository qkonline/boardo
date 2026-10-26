<script lang="ts">
  import Bell from './Bell.svelte';
  import Search from './Search.svelte';
  import { allPartsDone, statusOption } from '../../shared/rules';
  import { bgImage, tileBackground } from '../lib/background';
  import { hueColor } from '../lib/hue';
  import { app } from '../lib/store.svelte';
  import { cancelled } from '../lib/passkeys';
  import Icon from './Icon.svelte';
  import { flip } from 'svelte/animate';
  import { pathOf } from '../lib/route';
  import { tileDrag } from '../lib/tiledrag';

  let busy = $state<string | null>(null);

  // Each person's own order (R2.5a): drag a tile (hold it first on a touch screen), or Alt and an
  // arrow key on one. While dragging, the tiles show the order it would make.
  let preview = $state<string[] | null>(null);
  let lifted = $state<string | null>(null);
  const shown = $derived(preview ? preview.map((id) => app.boards.find((b) => b.id === id)).filter((b) => !!b) : app.boards);
  const arrange = (el: HTMLElement) =>
    tileDrag(el, {
      ids: () => app.boards.map((b) => b.id),
      preview: (ids, id) => ((preview = ids), (lifted = id ?? null)),
      drop: (ids) => void app.reorderBoards(ids),
    });
  function nudge(e: KeyboardEvent, id: string) {
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (!e.altKey || !step) return;
    e.preventDefault();
    const ids = app.boards.map((b) => b.id);
    const i = ids.indexOf(id);
    const j = i + step;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void app.reorderBoards(ids);
  }
  /** A tile is a link to its board (so it can open in a new tab); a plain click stays in the app. */
  function open(e: MouseEvent, id: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    app.go({ name: 'board', id });
  }
  // Links to the boards' background images, for their tiles.
  const links = $derived(app.files.links);
  $effect(() => {
    if (!app.online) return;
    for (const b of app.boards) {
      const img = bgImage(app.data[b.id]?.board);
      if (img) void app.files.ensure(b.id, [img]);
    }
  });
  let adding = $state(false);

  async function addKey() {
    adding = true;
    try {
      await app.addPasskey();
      app.say('Passkey added. Next time, sign in with it.');
    } catch (e) {
      if (!cancelled(e)) app.say((e as Error).message);
    } finally {
      adding = false;
    }
  }

  function counts(id: string) {
    const b = app.data[id];
    if (!b) return null;
    let open = 0;
    let mine = 0;
    for (const c of b.card.values()) {
      if (c.archived) continue;
      const done = statusOption(c, b.statusField)?.role === 'completed' || allPartsDone(c);
      if (done) continue;
      open++;
      if (app.user && c.assignees.includes(app.user.id)) mine++;
    }
    return { open, mine, members: b.member.size };
  }

  async function join(id: string) {
    busy = id;
    await app.acceptInvite({ id });
    busy = null;
  }
  async function decline(id: string) {
    busy = id;
    try {
      await app.declineInvite(id);
    } catch (e) {
      app.say((e as Error).message);
    }
    busy = null;
  }
</script>

<main class="page">
  <header class="head">
    <h1>Boards</h1>
    <button class="key ink" onclick={() => (app.sheet = 'newBoard')}><Icon name="plus" plain /> New board</button>
    <Search where="head" />
    <Bell where="head" />
  </header>

  {#if app.offerPasskey}
    <section class="offer" aria-label="Passkey">
      <Icon name="lock" size={22} />
      <div class="what">
        <b>Sign in faster next time</b>
        <span class="label">Add a passkey and use Face ID, Touch ID or your screen lock instead of an emailed code.</span>
      </div>
      <div class="acts">
        <button class="btn ghost" onclick={() => app.dismissPasskey(false)}>Not now</button>
        <button class="key ink" disabled={adding} onclick={addKey}>Add a passkey</button>
      </div>
    </section>
  {/if}

  {#if app.invites.length}
    <section class="invites" aria-label="Invites">
      {#each app.invites as inv (inv.id)}
        <div class="invite">
          <span class="mark" style:background={hueColor(inv.board.hue)}></span>
          <div class="what">
            <b>{inv.board.name}</b>
            <span class="label">{inv.by ? `${inv.by} invited you` : 'You were invited'} as {inv.role === 'admin' ? 'an admin' : 'a member'}</span>
          </div>
          <div class="acts">
            <button class="btn" disabled={busy === inv.id} onclick={() => decline(inv.id)}>Decline</button>
            <button class="key ink" disabled={busy === inv.id} onclick={() => join(inv.id)}>Join</button>
          </div>
        </div>
      {/each}
    </section>
  {/if}

  {#if app.boards.length}
    <ul class="tiles" {@attach arrange}>
      {#each shown as b (b.id)}
        {@const n = counts(b.id)}
        {@const st = app.data[b.id]}
        {@const img = bgImage(st?.board)}
        <li data-board={b.id} class:lifted={lifted === b.id} animate:flip={{ duration: 180 }}>
          <a
            class="tile"
            href={pathOf({ name: 'board', id: b.id }, null, () => b.name)}
            draggable="false"
            onclick={(e) => open(e, b.id)}
            onkeydown={(e) => nudge(e, b.id)}
          >
            <span class="cover" style:background={tileBackground(st?.board, b.hue, img ? links[img]?.url : undefined)}>
              {#if b.role === 'admin'}<span class="badge">Admin</span>{/if}
            </span>
            <span class="info">
              <span class="name">{b.name}</span>
              <span class="meta">
                {#if n && st?.loaded}
                  {n.open} open{#if n.mine}<span class="mine">, {n.mine} yours</span>{/if}
                {:else}&nbsp;{/if}
              </span>
            </span>
          </a>
        </li>
      {/each}
      <li>
        <button class="tile new" onclick={() => (app.sheet = 'newBoard')}><Icon name="plus" /> Create new board</button>
      </li>
    </ul>
  {:else if !app.invites.length}
    <div class="empty">
      <p><b>No boards yet.</b></p>
      <p>Make one for a project, then invite the people working on it. Each person only sees the boards they're in.</p>
    </div>
  {/if}
</main>

<style>
  .page {
    padding: 20px max(var(--px), env(safe-area-inset-right)) calc(var(--bar-h) + 40px + env(safe-area-inset-bottom))
      max(var(--px), env(safe-area-inset-left));
    max-width: 1100px;
    margin: 0 auto;
    padding-top: max(20px, env(safe-area-inset-top));
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 18px;
  }
  .head h1 {
    flex: 1;
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 600;
  }
  .mark {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    flex: none;
  }
  .offer {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    margin-bottom: 18px;
    border-radius: var(--r-card);
    background: var(--tint-indigo);
    flex-wrap: wrap;
  }
  .invites {
    display: grid;
    gap: 10px;
    margin-bottom: 18px;
  }
  .invite {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--r-card);
    background: var(--raised);
    border: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .what {
    display: grid;
    gap: 3px;
    flex: 1;
    min-width: 160px;
  }
  .acts {
    display: flex;
    gap: 8px;
  }
  /* Boards as tiles, like Trello's: the background across the top, the name below. */
  .tiles {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
    gap: 14px;
  }
  @media (max-width: 480px) {
    .tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
  }
  /* The tile being dragged stays where it would land, faded; a floating copy follows the pointer. */
  .lifted {
    opacity: 0.35;
  }
  .tile {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    display: flex;
    text-decoration: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    flex-direction: column;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--raised);
    box-shadow: 0 2px 0 var(--line);
    overflow: hidden;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: var(--text);
  }
  @media (hover: hover) {
    .tile:hover {
      border-color: var(--line);
    }
    .tile:hover .cover {
      filter: brightness(0.95);
    }
  }
  .cover {
    height: 88px;
    flex: none;
    display: flex;
    justify-content: flex-end;
    align-items: flex-start;
    padding: 8px;
  }
  .info {
    display: grid;
    gap: 3px;
    padding: 10px 12px 12px;
  }
  .name {
    font-weight: 600;
    font-size: 15px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .meta {
    color: var(--muted);
    font-size: 12.5px;
  }
  .badge {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 6px;
    border-radius: var(--r-sm);
    background: var(--raised);
    color: var(--muted);
  }
  .tile.new {
    min-height: 150px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-direction: row;
    background: var(--sunk);
    border-style: dashed;
    box-shadow: none;
    color: var(--muted);
    font-weight: 500;
  }
  .empty {
    padding: 28px 18px;
    border: 1px dashed var(--line);
    border-radius: var(--r-card);
    color: var(--muted);
  }
  .empty p {
    margin: 0 0 6px;
  }
  .empty b {
    color: var(--text);
  }
</style>
