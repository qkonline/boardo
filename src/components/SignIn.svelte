<script lang="ts">
  import { onMount } from 'svelte';
  import { cancelled, passkeyAutofill, passkeysAvailable } from '../lib/passkeys';
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';

  let step = $state<'email' | 'code'>('email');
  let email = $state('');
  let code = $state('');
  let busy = $state(false);
  let error = $state('');
  let resent = $state(false);
  // Came straight to the code, with one already sent (asked for on another device, say).
  let had = $state(false);
  const invited = app.inviteToken != null;
  const canPasskey = passkeysAvailable();

  // Passkeys made for Boardo are offered in the email field's suggestions too, where the
  // browser can: picking one signs in straight away.
  onMount(() => {
    void passkeyAutofill().then((ok) => {
      if (!ok) return;
      app.signInWithPasskey(true).catch((e) => {
        if (!cancelled(e)) error = (e as Error).message;
      });
    });
  });

  async function withPasskey() {
    error = '';
    busy = true;
    try {
      await app.signInWithPasskey();
    } catch (e) {
      if (!cancelled(e)) error = (e as Error).message;
      busy = false;
    }
  }

  async function send(e?: Event) {
    e?.preventDefault();
    error = '';
    busy = true;
    try {
      await app.sendCode(email.trim());
      had = false;
      step = 'code';
      code = '';
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function verify(e?: Event) {
    e?.preventDefault();
    error = '';
    busy = true;
    try {
      await app.verifyCode(email.trim(), code);
    } catch (err) {
      error = (err as Error).message;
      busy = false;
    }
  }

  /** Skip sending: the code was asked for earlier, perhaps on another device, and still works. */
  function haveCode() {
    const field = document.getElementById('email') as HTMLInputElement;
    if (!field.reportValidity()) return;
    error = '';
    resent = false;
    had = true;
    step = 'code';
    code = '';
  }

  async function again() {
    resent = false;
    await send();
    if (!error) resent = true;
  }

  // Six digits typed or pasted: check them straight away, once (a wrong code isn't sent again
  // by itself, which would use up its tries).
  let tried = '';
  $effect(() => {
    const digits = code.replace(/\D/g, '');
    if (step !== 'code' || digits.length !== 6 || digits === tried || busy) return;
    tried = digits;
    void verify();
  });
</script>

<main class="wrap">
  <div class="card">
    <img src="{import.meta.env.BASE_URL}icon.svg?v=1" alt="" width="56" height="56" />
    <h1>Boardo</h1>
    {#if invited}
      <p class="lede">You've been invited to a board. Sign in with the email address the invite was sent to.</p>
    {:else}
      <p class="lede">Shared project boards. Sign in with your email, and we'll send you a code.</p>
    {/if}

    {#if step === 'email'}
      <form onsubmit={send}>
        <label class="label" for="email">Email</label>
        <input
          id="email"
          class="field"
          type="email"
          autocomplete="email webauthn"
          inputmode="email"
          placeholder="you@example.com"
          bind:value={email}
          required
        />
        <button class="key ink" type="submit" disabled={busy || !email.trim()}>
          <Icon name="mail" plain /> Send me a code
        </button>
        <button class="btn ghost have" type="button" disabled={busy} onclick={haveCode}>I already have a code</button>
        {#if canPasskey}
          <div class="or"><span>or</span></div>
          <button class="key" type="button" disabled={busy} onclick={withPasskey}><Icon name="lock" /> Sign in with a passkey</button>
          <p class="note">Face ID, Touch ID or your device's screen lock, once you've added a passkey in Account.</p>
        {/if}
      </form>
    {:else}
      <form onsubmit={verify}>
        {#if had}
          <p class="sent">Type the 6-digit code we sent to <b>{email}</b>. Each code works for 10 minutes.</p>
        {:else}
          <p class="sent">We sent a 6-digit code to <b>{email}</b>. It works for 10 minutes.</p>
        {/if}
        <label class="label" for="code">Code</label>
        <input
          id="code"
          class="field code large-text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="7"
          placeholder="123456"
          bind:value={code}
          required
        />
        <button class="key ink" type="submit" disabled={busy || code.replace(/\D/g, '').length !== 6}>Sign in</button>
        <div class="row">
          <button type="button" class="btn ghost" onclick={() => ((step = 'email'), (error = ''))}>Use another email</button>
          <button type="button" class="btn ghost" onclick={again} disabled={busy}>Send a new code</button>
        </div>
        {#if resent}<p class="ok" role="status">A new code is on its way.</p>{/if}
      </form>
    {/if}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </div>
</main>

<style>
  .wrap {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px max(var(--px), env(safe-area-inset-left)) 24px max(var(--px), env(safe-area-inset-right));
  }
  .card {
    width: min(400px, 100%);
    display: grid;
    gap: 14px;
  }
  img {
    border-radius: 12px;
  }
  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 600;
  }
  .lede {
    margin: 0;
    color: var(--muted);
  }
  form {
    display: grid;
    gap: 10px;
    margin-top: 8px;
  }
  .code {
    font-size: 26px;
    letter-spacing: 0.3em;
    font-weight: 600;
  }
  .key {
    margin-top: 6px;
  }
  .have {
    justify-self: center;
    min-height: 44px;
    padding: 0 10px;
    color: var(--muted);
    font-size: 14px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .row .btn {
    padding: 0 4px;
    color: var(--muted);
  }
  .sent {
    margin: 0;
    color: var(--muted);
  }
  .or {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--faint);
    font-size: 13px;
    margin: 4px 0;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .note {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  .err {
    margin: 0;
    color: var(--redT);
  }
  .ok {
    margin: 0;
    color: var(--grT);
  }
</style>
