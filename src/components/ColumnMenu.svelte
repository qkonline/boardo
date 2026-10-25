<script lang="ts">
  import { sameNamed } from '../../shared/rules';
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';

  /** A column's options: rename, move, remove (asking where its cards go, R3.4). */
  let { board, colId, onclose }: { board: string; colId: string; onclose: () => void } = $props();
  const b = $derived(app.data[board]);
  const col = $derived(b.column.get(colId));
  const idx = $derived(b.columns.findIndex((c) => c.id === colId));
  const count = $derived(b.cardsIn(colId).length);
  // svelte-ignore state_referenced_locally
  let name = $state(col?.name ?? '');
  let removing = $state(false);
  // svelte-ignore state_referenced_locally
  let target = $state(b.columns.find((c) => c.id !== colId)?.id ?? '');

  /** Another column already called what's being typed. */
  const clash = $derived(sameNamed(b.columns, name, colId));

  async function rename(e: Event) {
    e.preventDefault();
    if (clash) return;
    await app.renameColumn(board, colId, name);
    onclose();
  }
  async function remove(moveTo: string | null) {
    // Which column, before closing: closing lets go of it (colId comes from the board's view).
    const [bd, col] = [board, colId];
    onclose();
    await app.removeColumn(bd, col, moveTo);
  }
</script>

<Sheet variant="form" label="Column options" {onclose}>
  {#if col}
    <div class="body">
      <div class="top">
        <h2>{col.name || 'Untitled column'}</h2>
        <button type="button" class="icon-btn" aria-label="Close" onclick={onclose}><Icon name="close" /></button>
      </div>
      {#if !removing}
        <form class="rename" onsubmit={rename}>
          <label class="label" for="cname">Name</label>
          <div class="row">
            <input id="cname" class="field" maxlength="100" bind:value={name} />
            <button class="key" type="submit" disabled={!name.trim() || name.trim() === col.name || !!clash}>Rename</button>
          </div>
          {#if clash}<p class="err" role="alert">There's already a column called {clash.name}.</p>{/if}
        </form>
        <div class="row">
          <button class="btn" disabled={idx <= 0} onclick={() => app.moveColumn(board, colId, -1)}
            ><Icon name="left" /> Move left</button
          >
          <button class="btn" disabled={idx >= b.columns.length - 1} onclick={() => app.moveColumn(board, colId, 1)}
            >Move right <Icon name="right" /></button
          >
        </div>
        <button class="btn danger" onclick={() => (count ? (removing = true) : remove(null))}
          ><Icon name="trash" /> Remove column</button
        >
      {:else}
        <p>
          This column has {count}
          {count === 1 ? 'card' : 'cards'}. Where should {count === 1 ? 'it' : 'they'} go?
        </p>
        {#if b.columns.length > 1}
          <label class="label" for="moveto">Move to</label>
          <select id="moveto" class="field" bind:value={target}>
            {#each b.columns.filter((c) => c.id !== colId) as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
          <button class="key ink" onclick={() => remove(target)}>Move cards and remove</button>
        {/if}
        <button class="btn danger" onclick={() => remove(null)}>Archive cards and remove</button>
        <button class="btn ghost" onclick={() => (removing = false)}>Cancel</button>
      {/if}
    </div>
  {/if}
</Sheet>

<style>
  .body {
    display: grid;
    gap: 12px;
    padding: 8px 20px max(20px, env(safe-area-inset-bottom));
    overflow: auto;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .err {
    margin: 6px 0 0;
    color: var(--redT);
    font-size: 13px;
  }
  h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .rename {
    display: grid;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .row .field {
    flex: 1;
  }
  .row .btn {
    flex: 1;
  }
  p {
    margin: 0;
  }
</style>
