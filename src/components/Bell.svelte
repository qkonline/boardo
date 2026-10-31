<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Note } from '../../shared/model';
  import { ago, LOOK, sentence } from '../lib/notetext';
  import { app } from '../lib/store.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  /**
   * The bell (look A, "Feed", as in Facebook): a red count of what came since it was last
   * opened, and the latest updates in a list. On a computer it sits in the top bar and the list
   * drops below it; on a phone it sits at the top right of each screen and the list fills the
   * page below it, down to the tab bar. Only the one in view opens.
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
  const open = $derived(app.bell && mine);

  let button: HTMLButtonElement | null = $state(null);
  let panel: HTMLElement | null = $state(null);
  /** On a phone the list starts just below the bell. */
  let top = $state(0);
  let only = $state<'all' | 'unread'>('all');

  const unread = $derived(app.notes.filter((n) => !n.read).length);
  const shown = $derived(only === 'unread' ? app.notes.filter((n) => !n.read) : app.notes);
  const fresh = $derived(shown.filter((n) => !n.read));
  const earlier = $derived(shown.filter((n) => n.read));

  async function toggle() {
    if (app.bell) return close();
    if (button) top = button.getBoundingClientRect().bottom + 6;
    app.openBell();
    await tick();
    panel?.focus();
  }
  function close() {
    app.bell = false;
    button?.focus();
  }
  function pick(n: Note) {
    app.openNote(n);
  }
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && (e.stopPropagation(), close())} />

<span class="bell {where}">
  <button
    bind:this={button}
    class="icon-btn ring"
    class:on={open}
    aria-label={app.unseen ? `Updates, ${app.unseen} new` : 'Updates'}
    aria-expanded={open}
    onclick={toggle}
  >
    <Icon name="bell" size={22} />
    {#if app.unseen}<span class="count" aria-hidden="true">{app.unseen > 99 ? '99+' : app.unseen}</span>{/if}
  </button>

  {#if open}
    <button class="catch" aria-label="Close updates" tabindex="-1" onclick={close}></button>
    <section bind:this={panel} class="list" style:--top="{top}px" aria-label="Updates" tabindex="-1">
      <div class="top">
        <h2>Updates</h2>
        {#if unread}<button class="link" onclick={() => app.readAllNotes()}>Mark all as read</button>{/if}
      </div>
      <div class="seg" role="group" aria-label="Show">
        <button aria-pressed={only === 'all'} onclick={() => (only = 'all')}>All</button>
        <button aria-pressed={only === 'unread'} onclick={() => (only = 'unread')}>Unread{unread ? ` ${unread}` : ''}</button>
      </div>
      {#if !shown.length}
        <p class="empty">{only === 'unread' ? "You're all caught up." : 'Nothing yet. Updates about your cards show here.'}</p>
      {/if}
      {#if fresh.length}
        <h3>New</h3>
        {#each fresh as n (n.id)}{@render item(n)}{/each}
      {/if}
      {#if earlier.length}
        <h3>Earlier</h3>
        {#each earlier as n (n.id)}{@render item(n)}{/each}
      {/if}
    </section>
  {/if}
</span>

{#snippet item(n: Note)}
  <button class="item" class:unread={!n.read} onclick={() => pick(n)}>
    <span class="who">
      {#if n.by}
        <Avatar person={n.by} size={40} />
      {:else}
        <span class="auto" style:background="var(--tint-slate)"><Icon name="boards" size={20} /></span>
      {/if}
      <span class="kind" style:background={LOOK[n.kind].colour} aria-hidden="true">{LOOK[n.kind].mark}</span>
    </span>
    <span class="body">
      <span class="say">{#each sentence(n) as p, i (i)}{#if p.strong}<b>{p.text}</b>{:else}{p.text}{/if}{/each}</span>
      {#if n.quote}<span class="quote">{n.quote}</span>{/if}
      <span class="meta">{n.boardName} · {ago(n.at)}</span>
    </span>
    {#if !n.read}<span class="dot"><span class="sr-only">Unread</span></span>{/if}
  </button>
{/snippet}

<style>
  .bell {
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
  .ring {
    position: relative;
  }
  .ring.on {
    background: var(--tint-indigo);
  }
  .count {
    position: absolute;
    top: 3px;
    right: 2px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    box-sizing: border-box;
    border-radius: 9px;
    background: var(--badge);
    color: #fff;
    font: 600 11px/18px var(--font);
    text-align: center;
    box-shadow: 0 0 0 2px var(--bg);
    pointer-events: none;
  }
  .bar .count {
    box-shadow: 0 0 0 2px var(--raised);
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
    outline: none;
    text-align: left;
    color: var(--text);
  }
  .bar .list {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 412px;
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
  /* The same height with or without Mark all as read. */
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 12px 8px 8px 16px;
  }
  h2 {
    margin: 0;
    font: 600 18px/1.2 var(--font);
  }
  .head h2 {
    font-size: 20px;
  }
  .link {
    margin-left: auto;
    min-height: 40px;
    padding: 0 8px;
    border: none;
    background: none;
    color: var(--t-indigo);
    font: 500 14px/1 var(--font);
    cursor: pointer;
  }
  .seg {
    display: flex;
    gap: 6px;
    padding: 0 16px 10px;
  }
  .seg button {
    height: 34px;
    padding: 0 14px;
    border-radius: 17px;
    border: 1px solid var(--border);
    background: var(--raised);
    color: var(--muted);
    font: 500 14px/1 var(--font);
    cursor: pointer;
  }
  .seg button[aria-pressed='true'] {
    border-color: var(--text);
    background: var(--text);
    color: var(--bg);
  }
  h3 {
    margin: 0;
    padding: 8px 16px 6px;
    font: 600 12px/1 var(--font);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .empty {
    margin: 0;
    padding: 18px 16px 24px;
    color: var(--muted);
    font-size: 14px;
  }
  .item {
    width: 100%;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 10px 16px;
    border: none;
    border-top: 1px solid var(--border);
    background: var(--raised);
    color: inherit;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .item.unread {
    background: color-mix(in oklab, var(--accent) 6%, var(--raised));
  }
  .item:hover {
    background: var(--sunk);
  }
  .who {
    position: relative;
    flex: none;
    width: 40px;
    height: 40px;
  }
  .auto {
    width: 40px;
    height: 40px;
    border-radius: var(--r-ctl);
    display: grid;
    place-items: center;
  }
  .kind {
    position: absolute;
    right: -4px;
    bottom: -4px;
    width: 20px;
    height: 20px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    color: #fff;
    font: 600 11px/1 var(--font);
    box-shadow: 0 0 0 2px var(--raised);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 3px;
  }
  .say {
    font-size: 14px;
    line-height: 1.35;
  }
  .say b {
    font-weight: 600;
  }
  .quote {
    font-size: 13px;
    line-height: 1.35;
    color: var(--muted);
    background: var(--sunk);
    border-radius: var(--r-sm);
    padding: 6px 8px;
    overflow-wrap: anywhere;
  }
  .meta {
    font-size: 12px;
    color: var(--muted);
  }
  .unread .meta {
    color: var(--t-indigo);
    font-weight: 500;
  }
  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    margin-top: 15px;
    border-radius: 5px;
    background: var(--accent);
  }
  .head .say {
    font-size: 15px;
  }
  .head .quote {
    font-size: 14px;
  }
  .head .meta {
    font-size: 13px;
  }
  .head .item {
    padding: 12px 16px;
  }
  @media (prefers-reduced-motion: reduce) {
    .list {
      animation: none;
    }
  }
  @media (pointer: coarse) {
    .seg button {
      height: 44px;
      border-radius: 22px;
    }
  }
</style>
