<script lang="ts">
  import { call } from '../lib/api';
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';

  /**
   * Another app asking to connect (OAuth, R8.1): Elastic opens this page, the person allows or
   * cancels, and Boardo sends them back with a one-time code (or a refusal).
   */
  let { req, ondone }: { req: Record<string, string>; ondone: () => void } = $props();
  let busy = $state(false);
  let error = $state('');

  async function answer(allow: boolean) {
    busy = true;
    error = '';
    try {
      const res = await call<{ redirect: string }>('/oauth/approve', { ...req, deny: !allow });
      location.href = res.redirect;
    } catch (e) {
      error = (e as Error).message;
      busy = false;
    }
  }
</script>

<main class="wrap">
  <div class="card">
    <div class="marks">
      <img src="{import.meta.env.BASE_URL}icon.svg?v=1" alt="" width="48" height="48" />
      <Icon name="link" size={22} />
      <span class="other">E</span>
    </div>
    <h1>Connect Elastic?</h1>
    <p>Elastic wants to see the cards assigned to you and log your time on them.</p>
    <ul>
      <li><Icon name="check" /> See cards assigned to you that have dates: title, project, status and dates</li>
      <li><Icon name="check" /> Start and stop timers on them, and mark your part done</li>
      <li><Icon name="close" /> Never comments, files, other fields or other people's cards</li>
    </ul>
    <p class="small">Signed in as {app.user?.email}. You can disconnect it any time in Account.</p>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="row">
      <button class="btn" disabled={busy} onclick={() => answer(false)}>Cancel</button>
      <button class="key ink" disabled={busy} onclick={() => answer(true)}>Allow</button>
    </div>
    <button class="btn ghost" onclick={ondone}>Not now, open Boardo</button>
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
    width: min(440px, 100%);
    display: grid;
    gap: 14px;
  }
  .marks {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .marks img {
    border-radius: 10px;
  }
  .other {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    background: var(--text);
    color: var(--bg);
    font: 600 22px var(--font);
  }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
  }
  p {
    margin: 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 12px 14px;
    display: grid;
    gap: 10px;
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    font-size: 14px;
  }
  li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .small {
    color: var(--muted);
    font-size: 13px;
  }
  .err {
    color: var(--redT);
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .ghost {
    color: var(--muted);
  }
</style>
