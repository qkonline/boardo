<script lang="ts">
  import type { Hue } from '../../shared/model';
  import { call } from '../lib/api';
  import { when } from '../lib/dates';
  import { cancelled, passkeysAvailable } from '../lib/passkeys';
  import { app, type Theme } from '../lib/store.svelte';
  import HuePicker from './HuePicker.svelte';
  import Icon from './Icon.svelte';

  // svelte-ignore state_referenced_locally
  let name = $state(app.user?.name ?? '');
  // svelte-ignore state_referenced_locally
  let hue = $state<Hue>((app.user?.hue as Hue) ?? 'indigo');
  let saving = $state(false);
  const changed = $derived(!!app.user && (name.trim() !== (app.user.name ?? '') || hue !== app.user.hue));

  let keys = $state<{ id: string; label: string; created: number; used: number | null }[] | null>(null);
  let addingKey = $state(false);

  async function loadKeys() {
    try {
      keys = (await call<{ passkeys: NonNullable<typeof keys> }>('/me/passkeys')).passkeys;
    } catch {
      keys = null;
    }
  }
  $effect(() => {
    if (app.online) void loadKeys();
  });
  async function addKey() {
    addingKey = true;
    try {
      await app.addPasskey();
      app.say('Passkey added.');
      await loadKeys();
    } catch (e) {
      if (!cancelled(e)) app.say((e as Error).message);
    } finally {
      addingKey = false;
    }
  }
  async function removeKey(id: string) {
    armed = null;
    try {
      await call('/me/passkeys/remove', { id });
      await loadKeys();
      app.say("Passkey removed from Boardo. You can also delete it from your device's passwords.");
    } catch (e) {
      app.say((e as Error).message);
    }
  }

  let apps = $state<{ id: string; label: string; client: string; created: number; used: number }[] | null>(null);
  let armed = $state<string | null>(null);

  async function loadApps() {
    try {
      apps = (await call<{ apps: NonNullable<typeof apps> }>('/apps')).apps;
    } catch {
      apps = null;
    }
  }
  $effect(() => {
    if (app.online) void loadApps();
  });

  async function save() {
    saving = true;
    try {
      await app.saveProfile({ name: name.trim(), hue });
      app.say('Saved.');
    } catch (e) {
      app.say((e as Error).message);
    } finally {
      saving = false;
    }
  }

  async function revoke(id: string) {
    armed = null;
    try {
      await call('/apps/revoke', { id });
      await loadApps();
    } catch (e) {
      app.say((e as Error).message);
    }
  }

  async function del() {
    try {
      await app.deleteAccount();
    } catch (e) {
      armed = null;
      app.say((e as Error).message);
    }
  }

  const themes: { id: Theme; label: string; icon: 'auto' | 'sun' | 'moon' }[] = [
    { id: 'auto', label: 'Device', icon: 'auto' },
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];
</script>

<main class="page">
  <h1>Account</h1>

  <section>
    <h2>You</h2>
    <div class="card form">
      <p class="email">Signed in as <b>{app.user?.email}</b></p>
      <label class="label" for="me-name">Name</label>
      <input id="me-name" class="field" maxlength="60" autocomplete="name" bind:value={name} />
      <span class="label">Colour</span>
      <HuePicker bind:value={hue} />
      <div><button class="key ink" disabled={saving || !changed || !name.trim()} onclick={save}>Save</button></div>
    </div>
  </section>

  {#if passkeysAvailable() || keys?.length}
    <section>
      <h2>Passkeys</h2>
      <p class="note">Sign in with Face ID, Touch ID or your device's screen lock instead of an emailed code. Add one on each device you use.</p>
      {#if keys?.length}
        <ul class="card list">
          {#each keys as k (k.id)}
            <li>
              <span class="who"><b>{k.label}</b><small>Added {when(k.created)}{k.used ? `, last used ${when(k.used)}` : ''}</small></span>
              {#if armed === `key-${k.id}`}
                <button class="btn danger" onclick={() => removeKey(k.id)}>Remove</button>
                <button class="btn ghost" onclick={() => (armed = null)}>Keep</button>
              {:else}
                <button class="btn" onclick={() => (armed = `key-${k.id}`)}>Remove</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if passkeysAvailable()}
        <div><button class="key" disabled={addingKey || !app.online} onclick={addKey}><Icon name="lock" /> Add a passkey on this device</button></div>
      {/if}
    </section>
  {/if}

  <section>
    <h2>Theme</h2>
    <div class="seg" role="group" aria-label="Theme">
      {#each themes as t (t.id)}
        <button aria-pressed={app.theme === t.id} onclick={() => app.setTheme(t.id)}><Icon name={t.icon} /> {t.label}</button>
      {/each}
    </div>
  </section>

  <section>
    <h2>Connected apps</h2>
    <p class="note">
      Apps you've let see the cards assigned to you, like Elastic. Each connection belongs to one device. Remove one to cut it off.
    </p>
    {#if apps?.length}
      <ul class="card list">
        {#each apps as a (a.id)}
          <li>
            <span class="who"><b>{a.label}</b><small>Connected {when(a.created)}, last used {when(a.used)}</small></span>
            {#if armed === a.id}
              <button class="btn danger" onclick={() => revoke(a.id)}>Disconnect</button>
              <button class="btn ghost" onclick={() => (armed = null)}>Keep</button>
            {:else}
              <button class="btn" onclick={() => (armed = a.id)}>Disconnect</button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if apps}
      <p class="note">None. To see your cards in Elastic, open Elastic's Settings, then Projects, then Connect Boardo.</p>
    {/if}
  </section>

  <section class="end">
    <button class="btn" onclick={() => app.signOut()}>Sign out</button>
    {#if armed === 'delete'}
      <p>Delete your account? You'll leave every board, and this can't be undone.</p>
      <div class="row">
        <button class="btn danger" onclick={del}>Delete my account</button>
        <button class="btn ghost" onclick={() => (armed = null)}>Keep it</button>
      </div>
    {:else}
      <button class="btn danger" onclick={() => (armed = 'delete')}><Icon name="trash" /> Delete account</button>
    {/if}
    <p class="small">Boardo is open source: <a href="https://github.com/qkonline/boardo" target="_blank" rel="noopener">github.com/qkonline/boardo</a></p>
  </section>
</main>

<style>
  .page {
    max-width: 640px;
    margin: 0 auto;
    padding: max(20px, env(safe-area-inset-top)) max(var(--px), env(safe-area-inset-right))
      calc(var(--bar-h) + 40px + env(safe-area-inset-bottom)) max(var(--px), env(safe-area-inset-left));
    display: grid;
    gap: 24px;
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 600;
  }
  section {
    display: grid;
    gap: 10px;
  }
  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
  .card {
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }
  .form {
    display: grid;
    gap: 8px;
    padding: 14px;
  }
  .email {
    margin: 0 0 4px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .email b {
    color: var(--text);
  }
  .note {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }
  .seg {
    display: flex;
    background: var(--sunk);
    border-radius: var(--r-ctl);
    padding: 3px;
    gap: 2px;
  }
  .seg button {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--muted);
    font: 500 14px var(--font);
    min-height: 44px;
    border-radius: var(--r-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
  }
  .seg button[aria-pressed='true'] {
    background: var(--raised);
    color: var(--text);
    box-shadow: 0 1px 0 var(--line);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px 10px 10px 14px;
    flex-wrap: wrap;
  }
  .list li + li {
    border-top: 1px solid var(--border);
  }
  .who {
    flex: 1;
    min-width: 160px;
    display: grid;
  }
  .who small {
    color: var(--faint);
    font-size: 12.5px;
  }
  .end {
    border-top: 1px solid var(--border);
    padding-top: 18px;
    justify-items: start;
  }
  .end p {
    margin: 0;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .small {
    color: var(--faint);
    font-size: 13px;
  }
</style>
