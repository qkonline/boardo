<script lang="ts">
  import { call } from '../lib/api';
  import { cancelled, passkeysAvailable, proveWithPasskey } from '../lib/passkeys';
  import { app } from '../lib/store.svelte';

  // Before the account's email changes or the account goes: show it's you, with a passkey or a
  // code to the email it has (as in Elastic).
  let { passkeys, onok, oncancel }: { passkeys: boolean; onok: () => void; oncancel: () => void } = $props();
  let sent = $state(false);
  let code = $state('');
  let busy = $state(false);
  let error = $state('');

  async function go(fn: () => Promise<unknown>, then: () => void) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await fn();
      then();
    } catch (e) {
      if (!cancelled(e)) error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  const passkey = () => go(proveWithPasskey, onok);
  const send = () => go(() => call('/auth/prove/send'), () => (sent = true));
  function check(e: Event) {
    e.preventDefault();
    void go(() => call('/auth/prove', { code }), onok);
  }
</script>

<div class="prove" role="group" aria-label="Confirm it's you">
  <b>Confirm it's you first</b>
  {#if sent}
    <form onsubmit={check}>
      <p class="hint">We sent a code to <b>{app.user?.email}</b>. It works for 10 minutes.</p>
      <input
        class="field code large-text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="7"
        placeholder="123456"
        aria-label="Code to confirm it's you"
        bind:value={code}
        oninput={() => (error = '')}
        {@attach (el: HTMLInputElement) => el.focus()}
      />
      <div class="row">
        <button class="key ink" type="submit" disabled={busy || code.replace(/\D/g, '').length !== 6}>Confirm</button>
        <button class="btn ghost" type="button" onclick={oncancel}>Cancel</button>
      </div>
    </form>
  {:else}
    <p class="hint">Changing your email or deleting your account needs more than an open app.</p>
    <div class="row">
      {#if passkeys && passkeysAvailable()}<button class="btn" type="button" disabled={busy} onclick={passkey}>Use a passkey</button>{/if}
      <button class="btn" type="button" disabled={busy} onclick={send}>Email me a code</button>
      <button class="btn ghost" type="button" onclick={oncancel}>Cancel</button>
    </div>
  {/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}
</div>

<style>
  .prove,
  form {
    display: grid;
    gap: 8px;
    width: 100%;
  }
  .prove > b {
    font-weight: 600;
  }
  .hint b {
    overflow-wrap: anywhere;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-13);
  }
  .code {
    font-size: var(--fs-20);
    letter-spacing: 0.3em;
    font-weight: 600;
  }
  .err {
    margin: 0;
    color: var(--redT);
    font-size: var(--fs-14);
  }
</style>
