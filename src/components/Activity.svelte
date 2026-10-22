<script lang="ts">
  import { hueColor } from '../lib/hue';
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';
  import LogList from './LogList.svelte';

  /** The project log (R6.3): every card's log and the board's own, newest first. */
  let { id }: { id: string } = $props();
  const b = $derived(app.data[id]);
  let person = $state('all');
  let card = $state('all');
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
</script>

{#if b}
  <main class="page">
    <header class="head">
      <button class="icon-btn" aria-label="Back to the board" onclick={() => app.go({ name: 'board', id })}><Icon name="back" /></button>
      <div>
        <p class="crumb"><span class="mark" style:background={hueColor(b.board?.hue)}></span>{b.board?.name}</p>
        <h1>Activity</h1>
      </div>
    </header>
    <div class="filters">
      <select class="field" aria-label="Person" bind:value={person}>
        <option value="all">Everyone</option>
        {#each b.members as m (m.userId)}<option value={m.userId}>{m.name}</option>{/each}
      </select>
      <select class="field" aria-label="Card" bind:value={card}>
        <option value="all">Every card</option>
        <option value="board">The board itself</option>
        {#each cards as c (c.id)}<option value={c.id}>{c.title || 'Untitled'}</option>{/each}
      </select>
    </div>
    {#if logs.length}
      <div class="card"><LogList {b} {logs} limit={200} /></div>
    {:else}
      <p class="none">Nothing yet.</p>
    {/if}
  </main>
{/if}

<style>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: max(12px, env(safe-area-inset-top)) max(var(--px), env(safe-area-inset-right))
      calc(var(--bar-h) + 32px + env(safe-area-inset-bottom)) max(var(--px), env(safe-area-inset-left));
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 12px -10px;
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
  }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
  }
  .filters {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }
  .filters .field {
    flex: 1;
    min-width: 0;
  }
  .card {
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    padding: 4px 14px;
  }
  .none {
    color: var(--muted);
  }
</style>
