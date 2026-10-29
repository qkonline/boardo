<script lang="ts">
  import { onMount } from 'svelte';
  import Activity from './components/Activity.svelte';
  import Archive from './components/Archive.svelte';
  import BoardSettings from './components/BoardSettings.svelte';
  import BoardView from './components/BoardView.svelte';
  import CardSheet from './components/CardSheet.svelte';
  import Connect from './components/Connect.svelte';
  import Handoff from './components/Handoff.svelte';
  import Home from './components/Home.svelte';
  import MyCards from './components/MyCards.svelte';
  import NewBoard from './components/NewBoard.svelte';
  import Settings from './components/Settings.svelte';
  import SignIn from './components/SignIn.svelte';
  import TabBar from './components/TabBar.svelte';
  import Welcome from './components/Welcome.svelte';
  import { app } from './lib/store.svelte';
  import { freshness } from './lib/freshness.svelte';
  import PullIndicator from './components/PullIndicator.svelte';
  import SaveError from './components/SaveError.svelte';
  import Moving from './components/Moving.svelte';
  import { MOVED_TO } from './lib/move';
  import { samePlace } from './lib/route';
  import { focusPolling } from './lib/pollsocket';
  import Icon from './components/Icon.svelte';

  // Another app asking to connect (`?connect&client_id=...`): kept until answered.
  let connect = $state<Record<string, string> | null>(null);

  onMount(() => {
    const q = new URLSearchParams(location.search);
    if (q.has('connect')) {
      connect = Object.fromEntries(
        ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope'].map((k) => [k, q.get(k) ?? '']),
      );
      history.replaceState(null, '', location.pathname);
    }
    void app.init();

    // Pick up new builds at quiet moments, and pull down to refresh (freshness.svelte.ts).
    return freshness.start();
  });

  const s = $derived(app.screen);

  // Boards syncing over requests check the one on screen often, the others now and then.
  $effect(() => focusPolling(s.name === 'board' || s.name === 'boardSettings' ? s.id : (app.open?.board ?? null)));

  // The address and the window's title follow what's shown (src/lib/route.ts): a new place is a
  // step Back can return to; the same place with a new name, or the first one shown, replaces it.
  // The old address's last build (its own base) never touches them.
  let first = true;
  $effect(() => {
    if (MOVED_TO || import.meta.env.BASE_URL !== '/' || !app.ready || !app.user || connect || app.waiting) return;
    const path = app.path;
    document.title = app.title;
    if (path === location.pathname) return void (first = false);
    if (first || samePlace(path, location.pathname)) history.replaceState(null, '', path + location.search);
    else history.pushState(null, '', path);
    first = false;
  });
</script>

{#if MOVED_TO}
  <!-- The last build at the old address: it hands this copy over to the new one. -->
  <Moving />
{:else if !app.ready}
  <div class="loading" aria-busy="true"></div>
{:else if !app.user && app.handoff}
  <Handoff />
{:else if !app.user}
  <SignIn />
{:else if !app.user.name}
  <Welcome />
{:else if connect}
  <Connect req={connect} ondone={() => (connect = null)} />
{:else}
  <TabBar />
  {#if s.name === 'home'}
    <Home />
  {:else if s.name === 'board'}
    {#key s.id}<BoardView id={s.id} />{/key}
  {:else if s.name === 'boardSettings'}
    {#key s.id}<BoardSettings id={s.id} />{/key}
  {:else if s.name === 'mycards'}
    <MyCards />
  {:else if s.name === 'settings'}
    <Settings />
  {/if}
  {#if app.activity}
    <Activity id={app.activity} />
  {/if}
  {#if app.archive}
    <Archive id={app.archive} />
  {/if}
  {#if app.open}
    {#key app.open.board + app.open.id}<CardSheet board={app.open.board} id={app.open.id} />{/key}
  {/if}
  {#if app.sheet === 'newBoard'}
    <NewBoard />
  {/if}
{/if}

<PullIndicator />
<SaveError />

{#if app.toast}
  {#key app.toast.id}
    {@const t = app.toast}
    <div class="toast" class:has-undo={!!t.undo} role="status">
      {t.text}
      {#if t.undo}
        <button class="undo" onclick={() => (t.undo?.(), (app.toast = null))}><Icon name="undo" plain /> Undo</button>
      {/if}
    </div>
  {/key}
{/if}

<style>
  .loading {
    min-height: 100dvh;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(var(--bar-h) + 16px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 30;
    max-width: min(480px, calc(100% - 32px));
    width: max-content;
    padding: 12px 16px;
    border-radius: var(--r-ctl);
    background: var(--text);
    color: var(--bg);
    font-size: 14px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    /* A message, never in the way: taps go through to what's under it. */
    pointer-events: none;
  }
  .toast.has-undo {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 4px 4px 16px;
  }
  /* Only the Undo button takes taps; the rest of the toast still lets them through. */
  .undo {
    pointer-events: auto;
    min-height: 40px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    border-radius: var(--r-sm);
    background: color-mix(in oklab, var(--bg) 14%, transparent);
    color: var(--bg);
    font: 600 14px var(--font);
    cursor: pointer;
  }
  @media (min-width: 768px) {
    .toast {
      bottom: 24px;
    }
  }
</style>
