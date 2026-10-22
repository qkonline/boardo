<script lang="ts">
  import { hueColor } from '../lib/hue';
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';
  import LogList from './LogList.svelte';
  import Sheet from './Sheet.svelte';

  /**
   * The project log (R6.3): every card's log and the board's own, newest first, in a panel that
   * slides in from the right over the board. Opening a card from it stacks the card on top.
   */
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
  const close = () => (app.activity = null);
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
    <div class="scroll">
      {#if logs.length}
        <LogList {b} {logs} limit={200} />
      {:else}
        <p class="none">Nothing yet.</p>
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
  .filters {
    display: flex;
    gap: 8px;
    padding: 12px 20px;
    flex: none;
    border-bottom: 1px solid var(--border);
  }
  .filters .field {
    flex: 1;
    min-width: 0;
    min-height: 40px;
    padding: 6px 10px;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 20px max(24px, env(safe-area-inset-bottom));
  }
  .none {
    color: var(--muted);
  }
</style>
