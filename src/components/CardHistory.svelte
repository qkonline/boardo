<script lang="ts">
  import type { LogRec } from '../../shared/model';
  import type { BoardState } from '../lib/board.svelte';
  import { clock, dateOf, daysBetween, keyOf, shortDate, todayKey } from '../lib/dates';
  import { statusColors } from '../lib/hue';
  import { logText, logWho } from '../lib/logtext';
  import Avatar from './Avatar.svelte';
  import PersonLink from './PersonLink.svelte';

  /**
   * A card's history as a timeline: grouped by day, newest first, each entry a coloured point
   * for the kind of thing that happened, who did it, and when.
   */
  let { b, logs }: { b: BoardState; logs: LogRec[] } = $props();

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function dayName(key: string): string {
    const d = daysBetween(key, todayKey());
    if (d === 0) return 'Today';
    if (d === 1) return 'Yesterday';
    if (d < 7) return DAYS[dateOf(key).getDay()];
    return `${DAYS[dateOf(key).getDay()].slice(0, 3)} ${shortDate(key)}`;
  }

  const groups = $derived.by(() => {
    const out: { key: string; logs: LogRec[] }[] = [];
    for (const l of logs) {
      const key = keyOf(new Date(l.at));
      if (out.at(-1)?.key !== key) out.push({ key, logs: [] });
      out.at(-1)!.logs.push(l);
    }
    return out;
  });

  /** The colour of each kind of entry; a status change takes the colour of its new status. */
  function tone(l: LogRec): string {
    switch (l.action) {
      case 'created':
      case 'restored':
      case 'part_done':
        return 'var(--s-lime)';
      case 'moved':
      case 'linked':
      case 'unlinked':
        return 'var(--s-cyan)';
      case 'assigned':
      case 'unassigned':
      case 'file_added':
        return 'var(--s-indigo)';
      case 'commented':
        return 'var(--s-yellow)';
      case 'worked':
      case 'archived':
      case 'deleted':
        return 'var(--s-rose)';
      case 'status': {
        const o = b.statusField?.options?.find((x) => x.label === l.detail.to);
        return statusColors(o?.hue ?? 'indigo').bar;
      }
    }
    return 'var(--s-slate)';
  }
</script>

{#if !logs.length}
  <p class="none">Nothing has happened to this card yet.</p>
{:else}
  {#each groups as g (g.key)}
    <section class="day">
      <h3>{dayName(g.key)}</h3>
      <ol>
        {#each g.logs as l (l.id)}
          {@const who = logWho(l, b)}
          {@const text = logText(l, b, true)}
          <li style:--tone={tone(l)}>
            <span class="pt" aria-hidden="true"></span>
            {#if l.userId}<PersonLink person={b.member.get(l.userId)} {b}><Avatar person={b.member.get(l.userId)} size={22} /></PersonLink>{:else}<span class="auto" aria-hidden="true">B</span>{/if}
            <p class="what">
              {#if who}<PersonLink person={l.userId ? b.member.get(l.userId) : null} {b}><b>{who}</b></PersonLink> {text}{:else}{text.charAt(0).toUpperCase() + text.slice(1)}{/if}
            </p>
            <time datetime={new Date(l.at).toISOString()}>{clock(new Date(l.at))}</time>
          </li>
        {/each}
      </ol>
    </section>
  {/each}
{/if}

<style>
  .none {
    color: var(--muted);
    font-size: 13.5px;
    margin: 8px 0;
  }
  .day {
    display: grid;
    gap: 2px;
  }
  .day + .day {
    margin-top: 18px;
  }
  h3 {
    margin: 0 0 6px;
    font: 600 12.5px/1 var(--font);
    color: var(--muted);
    letter-spacing: 0.01em;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    position: relative;
  }
  /* The thread the points hang on. */
  ol::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 10px;
    bottom: 10px;
    width: 2px;
    border-radius: 1px;
    background: var(--border);
  }
  li {
    position: relative;
    display: grid;
    grid-template-columns: 10px 22px minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
    padding: 7px 0;
  }
  .pt {
    width: 10px;
    height: 10px;
    margin-top: 6px;
    border-radius: 50%;
    background: var(--tone);
    box-shadow: 0 0 0 3px var(--bg);
    position: relative;
  }
  .auto {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: inline-grid;
    place-items: center;
    font: 600 10px var(--font);
    color: var(--bg);
    background: linear-gradient(135deg, var(--stripe));
  }
  .what {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.45;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .what b {
    color: var(--text);
    font-weight: 600;
  }
  time {
    font: 500 11.5px/1.9 var(--font);
    color: var(--faint);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
</style>
