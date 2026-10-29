<script lang="ts">
  import { app } from '../lib/store.svelte';

  /**
   * Arriving from Boardo's old address with its sign-in: used only once the person says it's
   * them, so a link carrying someone else's sign-in can't put them in that account unawares.
   */
  let busy = $state(false);

  async function answer(yes: boolean) {
    busy = true;
    await app.takeHandoff(yes);
  }
</script>

<main class="wrap">
  <div class="card">
    <img src="{import.meta.env.BASE_URL}icon.svg?v=1" alt="" width="56" height="56" />
    <h1>Continue as {app.handoff?.email}?</h1>
    <p class="lede">Boardo has moved here from its old address. Continue signed in with this account, or sign in another way.</p>
    <button class="key ink" disabled={busy} onclick={() => answer(true)}>Continue</button>
    <button class="btn ghost" disabled={busy} onclick={() => answer(false)}>Not me</button>
  </div>
</main>

<style>
  .wrap {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px var(--px);
  }
  .card {
    width: min(400px, 100%);
    display: grid;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .lede {
    margin: 0 0 6px;
    color: var(--muted);
  }
  .key {
    min-height: 44px;
  }
</style>
