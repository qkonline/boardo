<script lang="ts">
  import type { LogRec } from '../../shared/model';
  import type { BoardState } from '../lib/board.svelte';
  import { when } from '../lib/dates';
  import { logText, logWho } from '../lib/logtext';
  import { app } from '../lib/store.svelte';

  /** Log entries, newest first: a card's own (`onCard`), or the board's. */
  let { b, logs, onCard = false, limit = 0 }: { b: BoardState; logs: LogRec[]; onCard?: boolean; limit?: number } =
    $props();
  let all = $state(false);
  const shown = $derived(limit && !all ? logs.slice(0, limit) : logs);
</script>

<ol class="log">
  {#each shown as l (l.id)}
    {@const who = logWho(l, b)}
    {@const text = logText(l, b, onCard)}
    <li>
      <span class="what">
        {#if who}<b>{who}</b> {text}{:else}{text.charAt(0).toUpperCase() + text.slice(1)}{/if}
        {#if !onCard && l.cardId && b.card.has(l.cardId)}
          <button class="open" onclick={() => app.openCard(b.id, l.cardId!)}>Open</button>
        {/if}
      </span>
      <time datetime={new Date(l.at).toISOString()}>{when(l.at)}</time>
    </li>
  {/each}
</ol>
{#if limit && logs.length > limit && !all}
  <button class="btn ghost more" onclick={() => (all = true)}>Show all {logs.length}</button>
{/if}

<style>
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 14px;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 0;
    border-top: 1px solid var(--border);
    color: var(--muted);
  }
  li:first-child {
    border-top: none;
  }
  .what {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  b {
    color: var(--text);
    font-weight: 600;
  }
  time {
    flex: none;
    color: var(--faint);
    font-size: 12.5px;
    white-space: nowrap;
  }
  .open {
    border: none;
    background: none;
    color: var(--accent);
    font: 500 13px var(--font);
    padding: 0 0 0 4px;
    cursor: pointer;
  }
  .more {
    color: var(--muted);
    padding: 0;
  }
</style>
