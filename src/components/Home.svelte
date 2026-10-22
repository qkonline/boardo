<script lang="ts">
  import { allPartsDone, statusOption } from '../../shared/rules';
  import { hueColor } from '../lib/hue';
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';

  let busy = $state<string | null>(null);

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
  </header>

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
    <ul class="list">
      {#each app.boards as b (b.id)}
        {@const n = counts(b.id)}
        <li>
          <button class="row" onclick={() => app.go({ name: 'board', id: b.id })}>
            <span class="mark" style:background={hueColor(b.hue)}></span>
            <span class="name">{b.name}</span>
            <span class="meta">
              {#if n && app.data[b.id]?.loaded}
                {n.open} open{#if n.mine}<span class="mine">, {n.mine} yours</span>{/if}
              {/if}
              {#if b.role === 'admin'}<span class="badge">Admin</span>{/if}
            </span>
            <Icon name="right" />
          </button>
        </li>
      {/each}
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
    max-width: 760px;
    margin: 0 auto;
    padding-top: max(20px, env(safe-area-inset-top));
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
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
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    overflow: hidden;
  }
  li + li {
    border-top: 1px solid var(--border);
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    min-height: 60px;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }
  @media (hover: hover) {
    .row:hover {
      background: var(--sunk);
    }
  }
  .name {
    flex: 1;
    font-weight: 600;
    font-size: 16px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .meta {
    color: var(--muted);
    font-size: 13px;
    display: inline-flex;
    gap: 8px;
    align-items: center;
    white-space: nowrap;
  }
  .badge {
    font-size: 11.5px;
    font-weight: 600;
    padding: 3px 6px;
    border-radius: var(--r-sm);
    background: var(--sunk);
    color: var(--muted);
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
