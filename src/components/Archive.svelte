<script lang="ts">
  import { when } from '../lib/dates';
  import { hueColor } from '../lib/hue';
  import { matchBoard, queryWords } from '../lib/search';
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';

  /**
   * A board's archived cards (R4.20, R4.21), in a panel that slides in from the right like
   * Activity, opened from beside the filters. A search finds them by the same rules as search
   * everywhere (src/lib/search.ts); a board's search opens it with its words. Each opens (stacked on top), comes back with Restore, or goes for
   * good (admins, or whoever made it).
   */
  let { id }: { id: string } = $props();
  const b = $derived(app.data[id]);
  // svelte-ignore state_referenced_locally
  let query = $state(app.archiveQuery);
  let armed = $state<string | null>(null);
  let busy = $state(false);

  /** Every word typed has to be found on the card; newest first, as the list is. */
  const found = $derived.by(() => {
    if (!b) return [];
    const words = queryWords(query);
    if (!words.length) return b.archived;
    const hits = new Set(matchBoard(b, words).map((h) => h.card.id));
    return b.archived.filter((c) => hits.has(c.id));
  });
  const close = () => (app.archive = null);

  async function del(cardId: string) {
    busy = true;
    try {
      await app.deleteCard(id, cardId);
      armed = null;
      app.say('Card deleted.');
    } catch (e) {
      app.say((e as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet variant="side" label="Archived cards" onclose={close}>
  {#if b}
    <div class="top">
      <div>
        <p class="crumb"><span class="mark" style:background={hueColor(b.board?.hue)}></span>{b.board?.name}</p>
        <h2>Archived cards</h2>
      </div>
      <button class="icon-btn" aria-label="Close" onclick={close}><Icon name="close" /></button>
    </div>
    <div class="search">
      <input class="field" type="search" placeholder="Search archived cards" aria-label="Search archived cards" bind:value={query} />
    </div>
    <div class="scroll">
      {#if !b.archived.length}
        <p class="none">No archived cards. A card archived from its window waits here, and can come back.</p>
      {:else if !found.length}
        <p class="none">No archived cards match.</p>
      {:else}
        <ul>
          {#each found as c (c.id)}
            {@const col = b.column.get(c.columnId)?.name}
            <li>
              <button class="open" onclick={() => app.openCard(id, c.id)}>
                <b>{c.title || 'Untitled'}</b>
                <span class="meta">{col ? `${col} · ` : ''}added {when(c.created)}</span>
              </button>
              <div class="acts">
                {#if armed === c.id}
                  <span class="ask">Delete for good?</span>
                  <button class="btn small danger" disabled={busy || !app.online} onclick={() => del(c.id)}>Delete</button>
                  <button class="btn small ghost" onclick={() => (armed = null)}>Keep</button>
                {:else}
                  <button class="btn small" onclick={() => app.archiveCard(id, c.id, false)}>Restore</button>
                  {#if app.canDelete(id, c.id)}
                    <button class="icon-btn" aria-label="Delete {c.title || 'Untitled'}" onclick={() => (armed = c.id)}><Icon name="trash" /></button>
                  {/if}
                {/if}
              </div>
            </li>
          {/each}
        </ul>
        <p class="note">Deleting a card removes it, its comments and its files for everyone. Its history stays in Activity.</p>
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
  .search {
    padding: 12px 20px;
    flex: none;
    border-bottom: 1px solid var(--border);
  }
  .search .field {
    width: 100%;
    min-height: 40px;
    padding: 6px 12px;
    box-sizing: border-box;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 20px max(24px, env(safe-area-inset-bottom));
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .open {
    flex: 1;
    min-width: 160px;
    display: grid;
    gap: 2px;
    padding: 6px 8px;
    margin-left: -8px;
    border: none;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  @media (hover: hover) {
    .open:hover {
      background: var(--sunk);
    }
  }
  .open b {
    font-weight: 600;
    font-size: 14.5px;
  }
  .meta {
    font-size: 12.5px;
    color: var(--faint);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ask {
    font-size: 13px;
    color: var(--redT);
  }
  .none,
  .note {
    color: var(--muted);
    font-size: 13.5px;
  }
</style>
