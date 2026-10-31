<script lang="ts">
  import Bell from './Bell.svelte';
  import type { Hue } from '../../shared/model';
  import { call } from '../lib/api';
  import { when } from '../lib/dates';
  import type { CardRec, ColumnRec, CommentRec, FieldRec } from '../../shared/model';
  import { splitRid } from '../lib/db';
  import { cancelled, passkeysAvailable } from '../lib/passkeys';
  import { squarePhoto } from '../lib/images';
  import { alertsOff, alertsOn, alertState, type AlertState } from '../lib/push';
  import { app, type Theme } from '../lib/store.svelte';
  import Avatar from './Avatar.svelte';
  import HuePicker from './HuePicker.svelte';
  import Icon from './Icon.svelte';

  // svelte-ignore state_referenced_locally
  let name = $state(app.user?.name ?? '');
  // svelte-ignore state_referenced_locally
  let hue = $state<Hue>((app.user?.hue as Hue) ?? 'indigo');
  let saving = $state(false);

  // Changing the email: a code goes to the new address, and only that changes it.
  let emailStep = $state<'idle' | 'new' | 'code'>('idle');
  let newEmail = $state('');
  let emailCode = $state('');
  let emailBusy = $state(false);
  let emailError = $state('');
  async function sendChange(e: Event) {
    e.preventDefault();
    emailBusy = true;
    emailError = '';
    try {
      await app.sendEmailChange(newEmail.trim());
      emailCode = '';
      emailStep = 'code';
    } catch (err) {
      emailError = (err as Error).message;
    } finally {
      emailBusy = false;
    }
  }
  async function confirmChange(e?: Event) {
    e?.preventDefault();
    emailBusy = true;
    emailError = '';
    try {
      await app.confirmEmailChange(newEmail.trim(), emailCode);
      emailStep = 'idle';
      app.say(`Your email is now ${app.user?.email}.`);
    } catch (err) {
      emailError = (err as Error).message;
    } finally {
      emailBusy = false;
    }
  }
  // Six digits typed or pasted: confirm straight away.
  $effect(() => {
    if (emailStep === 'code' && emailCode.replace(/\D/g, '').length === 6 && !emailBusy && !emailError) void confirmChange();
  });

  // A profile photo: made square and small on the device, shown to the people in your boards. A
  // new one (with a preview) or its removal is a draft until Save changes.
  let photoPicker: HTMLInputElement | null = $state(null);
  let photoBusy = $state(false);
  let photoDraft = $state<{ blob: Blob; url: string } | 'remove' | null>(null);
  const dropDraftPhoto = () => {
    if (photoDraft && photoDraft !== 'remove') URL.revokeObjectURL(photoDraft.url);
    photoDraft = null;
  };
  $effect(() => dropDraftPhoto);
  const hasPhoto = $derived(photoDraft ? photoDraft !== 'remove' : !!app.user?.photo);
  async function pickPhoto(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    photoBusy = true;
    try {
      const blob = await squarePhoto(f);
      dropDraftPhoto();
      photoDraft = { blob, url: URL.createObjectURL(blob) };
    } catch (err) {
      app.say((err as Error).message);
    } finally {
      photoBusy = false;
    }
  }
  function dropPhoto() {
    dropDraftPhoto();
    if (app.user?.photo) photoDraft = 'remove';
  }

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

  // Notifications on this device for updates in the bell (push.ts), worded as in Elastic.
  let alerts = $state<AlertState | null>(null);
  let alertDraft = $state<boolean | null>(null);
  const alertsShown = $derived(alertDraft == null ? alerts === 'on' : alertDraft);
  void alertState().then((s) => (alerts = s));
  const alertText = $derived(
    alerts === 'install'
      ? 'On iPhone and iPad, notifications work once Boardo is on your Home Screen.'
      : alerts === 'unsupported'
        ? "This browser can't show notifications. Updates still show in the bell."
        : alerts === 'blocked'
          ? "Notifications are blocked for this site. Allow them in your browser's site settings to turn them on here."
          : alertsShown
            ? "You'll get one for each update in the bell, even with Boardo closed or your phone locked."
            : "Get a notification for each update in the bell, even when you're not looking at Boardo.",
  );
  function toggleAlerts() {
    alertDraft = !alertsShown === (alerts === 'on') ? null : !alertsShown;
  }

  // Every choice on this page waits for the save bar's Save changes. Passkeys, connected apps,
  // the email (its own code), signing out and deleting are actions with their own keys.
  let themeDraft = $state<Theme | null>(null);
  const theme = $derived(themeDraft ?? app.theme);
  const changes = $derived([
    ...(photoDraft ? ['Photo'] : []),
    ...(app.user && name.trim() !== (app.user.name ?? '') ? ['Name'] : []),
    ...(app.user && hue !== app.user.hue ? ['Colour'] : []),
    ...(alertDraft != null && alertDraft !== (alerts === 'on') ? ['Notifications'] : []),
    ...(themeDraft && themeDraft !== app.theme ? ['Theme'] : []),
  ]);
  async function saveAll() {
    saving = true;
    try {
      // Notifications first, straight from the tap: the browser only asks for permission then.
      if (changes.includes('Notifications')) {
        try {
          alerts = alertDraft ? await alertsOn() : await alertsOff();
        } catch (e) {
          app.say((e as Error).message);
        }
        alertDraft = null;
      }
      if (changes.includes('Theme')) app.setTheme(themeDraft!);
      themeDraft = null;
      if (changes.includes('Name') || changes.includes('Colour')) await app.saveProfile({ name: name.trim(), hue });
      if (photoDraft === 'remove') await app.removePhoto();
      else if (photoDraft) await app.setPhoto(photoDraft.blob);
      dropDraftPhoto();
      app.say('Saved.');
    } catch (e) {
      app.say((e as Error).message);
    } finally {
      saving = false;
    }
  }
  function discard() {
    name = app.user?.name ?? '';
    hue = (app.user?.hue as Hue) ?? 'indigo';
    dropDraftPhoto();
    alertDraft = null;
    themeDraft = null;
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

  // Signing out clears this device, so changes that haven't reached the boards would be lost.
  // Online, a change just made usually goes out within a moment: wait a little before asking.
  let unsent = $state(0);
  let checking = $state(false);
  async function signOut() {
    checking = true;
    try {
      unsent = await app.unsent();
      for (let i = 0; unsent && navigator.onLine && i < 12; i++) {
        await new Promise((r) => setTimeout(r, 250));
        unsent = await app.unsent();
      }
    } finally {
      checking = false;
    }
    if (unsent) armed = 'signout';
    else await app.signOut();
  }

  async function signOutOthers() {
    try {
      await app.signOutOthers();
      app.say('Signed out of every other device.');
    } catch (e) {
      app.say((e as Error).message);
    } finally {
      armed = null;
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

  // Changes a board refused (not allowed any more, say): undone there, with a copy kept here.
  let undone = $state<Awaited<ReturnType<typeof app.undoneChanges>>>([]);
  void app.undoneChanges().then((u) => (undone = u));

  /** What an undone change was, in a few words, and the text in it worth copying. */
  function describe(id: string, data: unknown): { what: string; text: string } {
    const kind = splitRid(id)[1];
    if (data == null) return { what: `Deleted ${kind}`, text: '' };
    if (kind === 'card') {
      const c = data as CardRec;
      return { what: `Card: ${c.title || 'Untitled'}`, text: c.desc ? `${c.title}\n\n${c.desc}` : c.title };
    }
    if (kind === 'comment') {
      const c = data as CommentRec;
      return { what: `Comment: ${c.text.length > 60 ? c.text.slice(0, 60) + '…' : c.text}`, text: c.text };
    }
    if (kind === 'column') return { what: `Column: ${(data as ColumnRec).name}`, text: (data as ColumnRec).name };
    if (kind === 'field') return { what: `Field: ${(data as FieldRec).name}`, text: (data as FieldRec).name };
    return { what: 'Board settings', text: '' };
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      app.say('Copied.');
    } catch {
      app.say("Couldn't copy here.");
    }
  }

  async function clearUndone() {
    armed = null;
    await app.clearUndone();
    undone = [];
  }

  const themes: { id: Theme; label: string; icon: 'auto' | 'sun' | 'moon' }[] = [
    { id: 'auto', label: 'Device', icon: 'auto' },
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];
</script>

<main class="page" class:saving-room={changes.length > 0}>
  <div class="title">
    <h1>Account</h1>
    <Bell where="head" />
  </div>

  {#if undone.length}
    <section>
      <h2>Undone changes</h2>
      <p class="note">A board didn't allow these changes, often because your role changed while you were offline, so they were undone there. Copy anything you need, then clear the list.</p>
      <ul class="card list">
        {#each undone as u (u.id + u.at)}
          {@const d = describe(u.id, u.data)}
          <li>
            <span class="who"><b>{d.what}</b><small>{u.boardName}, {when(u.at)}</small></span>
            {#if d.text}<button class="btn" onclick={() => copy(d.text)}>Copy</button>{/if}
          </li>
        {/each}
      </ul>
      <div class="row">
        {#if armed === 'undone'}
          <button class="btn danger" onclick={clearUndone}>Clear</button>
          <button class="btn ghost" onclick={() => (armed = null)}>Keep</button>
        {:else}
          <button class="btn" onclick={() => (armed = 'undone')}>Clear the list</button>
        {/if}
      </div>
    </section>
  {/if}

  <section>
    <h2>You</h2>
    <div class="card form">
      <div class="photo">
        {#if app.user}<Avatar
            person={{ ...app.user, name: app.user.name ?? app.user.email, photo: photoDraft === 'remove' ? null : app.user.photo }}
            src={photoDraft && photoDraft !== 'remove' ? photoDraft.url : undefined}
            size={64}
          />{/if}
        <div class="photo-acts">
          <button class="btn" disabled={photoBusy || saving || !app.online} onclick={() => photoPicker?.click()}
            >{photoBusy ? 'Getting it ready…' : hasPhoto ? 'Change photo' : 'Add a photo'}</button
          >
          {#if hasPhoto}
            <button class="btn ghost" disabled={photoBusy || saving} onclick={dropPhoto}>Remove</button>
          {/if}
        </div>
        <input bind:this={photoPicker} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onchange={pickPhoto} />
      </div>
      <label class="label" for="me-name">Name</label>
      <input id="me-name" class="field" maxlength="60" autocomplete="name" bind:value={name} />
      <span class="label">Colour</span>
      <HuePicker bind:value={hue} />

      <div class="email-box">
        <span class="label">Email</span>
        {#if emailStep === 'idle'}
          <div class="email-row">
            <b class="addr">{app.user?.email}</b>
            <button class="btn" disabled={!app.online} onclick={() => ((emailStep = 'new'), (newEmail = ''), (emailError = ''))}>Change</button>
          </div>
        {:else if emailStep === 'new'}
          <form class="email-form" onsubmit={sendChange}>
            <input
              id="me-email"
              class="field"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="new@example.com"
              aria-label="New email"
              bind:value={newEmail}
              {@attach (el: HTMLInputElement) => el.focus()}
            />
            <div class="row">
              <button class="key ink" type="submit" disabled={emailBusy || !newEmail.trim()}>Send a code</button>
              <button class="btn ghost" type="button" onclick={() => (emailStep = 'idle')}>Cancel</button>
            </div>
            <p class="hint">We'll send a 6-digit code to the new address. Your email only changes once you enter it.</p>
          </form>
        {:else}
          <form class="email-form" onsubmit={confirmChange}>
            <p class="hint">We sent a code to <b>{newEmail.trim()}</b>. It works for 10 minutes.</p>
            <input
              id="me-email-code"
              class="field code large-text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="7"
              placeholder="123456"
              aria-label="Code"
              bind:value={emailCode}
              oninput={() => (emailError = '')}
              {@attach (el: HTMLInputElement) => el.focus()}
            />
            <div class="row">
              <button class="key ink" type="submit" disabled={emailBusy || emailCode.replace(/\D/g, '').length !== 6}>Change email</button>
              <button class="btn ghost" type="button" onclick={() => (emailStep = 'new')}>Back</button>
            </div>
          </form>
        {/if}
        {#if emailError}<p class="err" role="alert">{emailError}</p>{/if}
      </div>
    </div>
  </section>

  {#if alerts}
    <section>
      <h2>Notifications</h2>
      <div class="card alert">
        <div class="aw">
          <span class="ct">On this device</span>
          <span class="muted">{alertText}</span>
        </div>
        <button
          class="switch"
          class:on={alertsShown}
          role="switch"
          aria-checked={alertsShown}
          aria-label="Notifications on this device"
          disabled={saving || alerts === 'install' || alerts === 'unsupported' || alerts === 'blocked'}
          onclick={toggleAlerts}><span></span></button
        >
      </div>
    </section>
  {/if}

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
        <button aria-pressed={theme === t.id} onclick={() => (themeDraft = t.id === app.theme ? null : t.id)}><Icon name={t.icon} /> {t.label}</button>
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
    {#if armed === 'signout'}
      <p>
        {unsent === 1 ? "1 change hasn't" : `${unsent} changes haven't`} reached Boardo yet. Signing out now loses
        {unsent === 1 ? 'it' : 'them'}.{navigator.onLine ? '' : ` Connect to send ${unsent === 1 ? 'it' : 'them'} first.`}
      </p>
      <div class="row">
        <button class="btn danger" onclick={() => app.signOut()}>Sign out anyway</button>
        <button class="btn" onclick={() => app.downloadUnsaved()}>Download a backup</button>
        <button class="btn ghost" onclick={() => (armed = null)}>Stay signed in</button>
      </div>
    {:else}
      <button class="btn" disabled={checking} onclick={signOut}>Sign out</button>
    {/if}
    {#if armed === 'others'}
      <p>Sign out of Boardo on every other device? This one stays signed in.</p>
      <div class="row">
        <button class="btn danger" onclick={signOutOthers}>Sign out other devices</button>
        <button class="btn ghost" onclick={() => (armed = null)}>Cancel</button>
      </div>
    {:else}
      <button class="btn" onclick={() => (armed = 'others')}>Sign out other devices</button>
    {/if}
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

  {#if changes.length}
    <!-- One bar for everything on this page not saved yet. -->
    <div class="save-row" role="region" aria-label="Changes not saved">
      <div class="save-in">
        <span class="unsaved">Not saved yet: {changes.join(', ')}</span>
        <button class="key" disabled={saving} onclick={discard}>Discard</button>
        <button class="key ink" disabled={saving || !name.trim()} onclick={saveAll}>Save changes</button>
      </div>
    </div>
  {/if}
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
  .page.saving-room {
    padding-bottom: calc(var(--bar-h) + 120px + env(safe-area-inset-bottom));
  }
  .save-row {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(var(--bar-h) + env(safe-area-inset-bottom));
    z-index: 4;
    background: var(--raised);
    border-top: 1px solid var(--border);
  }
  .save-in {
    max-width: 640px;
    margin: 0 auto;
    box-sizing: border-box;
    padding: 12px max(var(--px), env(safe-area-inset-right)) 12px max(var(--px), env(safe-area-inset-left));
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }
  .unsaved {
    flex: 1;
    min-width: 160px;
    color: var(--muted);
    font-size: 14px;
  }
  @media (min-width: 768px) {
    .save-row {
      bottom: 0;
    }
  }
  h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 600;
  }
  .alert {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 14px 14px 16px;
  }
  .aw {
    flex: 1;
    display: grid;
    gap: 3px;
  }
  .ct {
    font-weight: 500;
  }
  .muted {
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.4;
  }
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
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
  .photo {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 6px;
  }
  .photo :global(.av) {
    border-radius: var(--r-card);
  }
  .photo-acts {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .email-box {
    display: grid;
    gap: 8px;
    margin-top: 10px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .email-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .addr {
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .email-form {
    display: grid;
    gap: 8px;
  }
  .email-form .row {
    display: flex;
    gap: 8px;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  .code {
    font-size: 22px;
    letter-spacing: 0.3em;
    font-weight: 600;
  }
  .err {
    margin: 0;
    color: var(--redT);
    font-size: 14px;
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
    flex-wrap: wrap;
    gap: 8px;
  }
  .small {
    color: var(--faint);
    font-size: 13px;
  }
</style>
