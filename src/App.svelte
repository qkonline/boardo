<script lang="ts">
  import { onMount } from 'svelte';
  import Activity from './components/Activity.svelte';
  import BoardSettings from './components/BoardSettings.svelte';
  import BoardView from './components/BoardView.svelte';
  import CardSheet from './components/CardSheet.svelte';
  import Connect from './components/Connect.svelte';
  import Home from './components/Home.svelte';
  import MyCards from './components/MyCards.svelte';
  import NewBoard from './components/NewBoard.svelte';
  import Settings from './components/Settings.svelte';
  import SignIn from './components/SignIn.svelte';
  import TabBar from './components/TabBar.svelte';
  import Welcome from './components/Welcome.svelte';
  import { app } from './lib/store.svelte';
  import { newBuildOut, reloadToUpdate } from './lib/update';

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

    // An installed app can stay open for days: pick up new builds when nothing is in progress.
    let last = Date.now();
    const check = async () => {
      if (Date.now() - last < 3600_000) return;
      last = Date.now();
      if (!(await newBuildOut())) return;
      const busy = app.open || app.sheet || document.activeElement?.matches('input, textarea, select');
      if (!busy) void reloadToUpdate();
    };
    const vis = () => !document.hidden && void check();
    document.addEventListener('visibilitychange', vis);
    const t = setInterval(check, 3600_000);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      clearInterval(t);
    };
  });

  const s = $derived(app.screen);
</script>

{#if !app.ready}
  <div class="loading" aria-busy="true"></div>
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
  {:else if s.name === 'activity'}
    <Activity id={s.id} />
  {:else if s.name === 'boardSettings'}
    {#key s.id}<BoardSettings id={s.id} />{/key}
  {:else if s.name === 'mycards'}
    <MyCards />
  {:else if s.name === 'settings'}
    <Settings />
  {/if}
  {#if app.open}
    {#key app.open.board + app.open.id}<CardSheet board={app.open.board} id={app.open.id} />{/key}
  {/if}
  {#if app.sheet === 'newBoard'}
    <NewBoard />
  {/if}
{/if}

{#if app.toast}
  {#key app.toast.id}
    <div class="toast" role="status">{app.toast.text}</div>
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
  }
  @media (min-width: 768px) {
    .toast {
      bottom: 24px;
    }
  }
</style>
