<script lang="ts">
  import type { Hue, Role } from '../../shared/model';
  import { call } from '../lib/api';
  import { when } from '../lib/dates';
  import { app } from '../lib/store.svelte';
  import Avatar from './Avatar.svelte';
  import FieldsEditor from './FieldsEditor.svelte';
  import HuePicker from './HuePicker.svelte';
  import Icon from './Icon.svelte';

  /** A board's settings: name and colour, people and invites, fields, the upload limit, archive. */
  let { id }: { id: string } = $props();
  const b = $derived(app.data[id]);
  const admin = $derived(app.isAdmin(id));
  const me = $derived(app.user?.id);

  // svelte-ignore state_referenced_locally
  let name = $state(b?.board?.name ?? '');
  // svelte-ignore state_referenced_locally
  let hue = $state<Hue>(b?.board?.hue ?? 'indigo');
  // svelte-ignore state_referenced_locally
  let limit = $state(b?.board?.maxUploadMB ?? 30);
  $effect(() => {
    if (b?.board) {
      name = b.board.name;
      hue = b.board.hue;
      limit = b.board.maxUploadMB;
    }
  });
  const changed = $derived(!!b?.board && (name.trim() !== b.board.name || hue !== b.board.hue));

  let email = $state('');
  let role = $state<Role>('member');
  let inviting = $state(false);
  let invites = $state<{ id: string; email: string; role: Role; created: number; expires: number }[]>([]);
  let armed = $state<string | null>(null);
  let busy = $state(false);

  async function loadInvites() {
    if (!admin || !app.online) return;
    try {
      invites = (await call<{ invites: typeof invites }>('/invites', { board: id })).invites;
    } catch {
      /* offline */
    }
  }
  $effect(() => {
    void loadInvites();
  });

  async function act(fn: () => Promise<unknown>, done?: string) {
    busy = true;
    try {
      await fn();
      if (done) app.say(done);
    } catch (e) {
      app.say((e as Error).message);
    } finally {
      busy = false;
      armed = null;
    }
  }

  async function invite(e: Event) {
    e.preventDefault();
    const to = email.trim();
    inviting = true;
    try {
      await call('/invites/create', { board: id, email: to, role });
      email = '';
      app.say(`Invite sent to ${to}.`);
      await loadInvites();
    } catch (err) {
      app.say((err as Error).message);
    } finally {
      inviting = false;
    }
  }
</script>

{#if b}
  <main class="page">
    <header class="head">
      <button class="icon-btn" aria-label="Back to the board" onclick={() => app.go({ name: 'board', id })}><Icon name="back" /></button>
      <div>
        <p class="crumb">{b.board?.name}</p>
        <h1>Board settings</h1>
      </div>
    </header>

    <section>
      <h2>Board</h2>
      {#if admin}
        <div class="card form">
          <label class="label" for="bs-name">Name</label>
          <input id="bs-name" class="field" maxlength="100" bind:value={name} />
          <span class="label">Colour</span>
          <HuePicker bind:value={hue} />
          <div>
            <button class="key ink" disabled={!changed || !name.trim()} onclick={() => app.saveBoard(id, { name: name.trim(), hue })}
              >Save</button
            >
          </div>
        </div>
      {:else}
        <p class="note">Only admins can change the board, its fields and who's in it.</p>
      {/if}
    </section>

    <section>
      <h2>People</h2>
      <ul class="card people">
        {#each b.members as m (m.userId)}
          <li>
            <Avatar person={m} size={32} />
            <span class="who"><b>{m.name}{m.userId === me ? ' (you)' : ''}</b><small>{m.email}</small></span>
            {#if admin && m.userId !== me}
              <select
                class="field role"
                aria-label="Role of {m.name}"
                value={m.role}
                onchange={(e) => act(() => app.setRole(id, m.userId, e.currentTarget.value as Role))}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              {#if armed === m.userId}
                <button class="btn danger" disabled={busy} onclick={() => act(() => app.removeMember(id, m.userId), `${m.name} was removed.`)}
                  >Remove</button
                >
              {:else}
                <button class="icon-btn" aria-label="Remove {m.name}" onclick={() => (armed = m.userId)}><Icon name="trash" /></button>
              {/if}
            {:else}
              <span class="badge">{m.role === 'admin' ? 'Admin' : 'Member'}</span>
            {/if}
          </li>
        {/each}
      </ul>

      {#if admin}
        <form class="card form invite" onsubmit={invite}>
          <label class="label" for="inv-email">Invite someone</label>
          <input
            id="inv-email"
            class="field"
            type="email"
            inputmode="email"
            autocomplete="off"
            placeholder="name@example.com"
            bind:value={email}
            required
          />
          <div class="row">
            <select class="field" aria-label="Invite as" bind:value={role}>
              <option value="member">As a member</option>
              <option value="admin">As an admin</option>
            </select>
            <button class="key ink" type="submit" disabled={inviting || !email.trim() || !app.online}><Icon name="mail" plain /> Send invite</button>
          </div>
          <p class="note">They get an email with a link and join once they sign in with that address. Invites work for 14 days.</p>
        </form>
        {#if invites.length}
          <h3 class="label">Waiting to join</h3>
          <ul class="card people">
            {#each invites as inv (inv.id)}
              <li>
                <span class="who"><b>{inv.email}</b><small>{inv.role === 'admin' ? 'Admin' : 'Member'}, sent {when(inv.created)}</small></span>
                <button class="btn small" disabled={busy} onclick={() => act(() => call('/invites/resend', { id: inv.id }).then(loadInvites), 'Invite sent again.')}
                  >Resend</button
                >
                <button class="btn small danger" disabled={busy} onclick={() => act(() => call('/invites/revoke', { id: inv.id }).then(loadInvites))}
                  >Cancel</button
                >
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>

    {#if admin}
      <section>
        <h2>Fields</h2>
        <p class="note">Every card in this board has these. Members fill them in; only admins change them.</p>
        <FieldsEditor {b} />
      </section>

      <section>
        <h2>Attachments</h2>
        <div class="card form">
          <label class="label" for="bs-limit">Largest file, in MB</label>
          <div class="row">
            <input id="bs-limit" class="field" type="number" inputmode="numeric" min="1" max="100" bind:value={limit} />
            <button
              class="key"
              disabled={!limit || limit < 1 || limit > 100 || limit === b.board?.maxUploadMB}
              onclick={() => app.saveBoard(id, { maxUploadMB: Math.round(limit) })}>Save</button
            >
          </div>
          <p class="note">Up to 100 MB. The default is 30 MB.</p>
        </div>
      </section>
    {/if}

    <section>
      <h2>Archived cards</h2>
      {#if b.archived.length}
        <ul class="card people">
          {#each b.archived as c (c.id)}
            <li>
              <span class="who"><b>{c.title || 'Untitled'}</b></span>
              {#if armed === `del-${c.id}`}
                <span class="ask">Delete for good?</span>
                <button class="btn small danger" disabled={busy || !app.online} onclick={() => act(() => app.deleteCard(id, c.id), 'Card deleted.')}
                  >Delete</button
                >
                <button class="btn small ghost" onclick={() => (armed = null)}>Keep</button>
              {:else}
                <button class="btn small" onclick={() => app.openCard(id, c.id)}>Open</button>
                <button class="btn small" onclick={() => app.archiveCard(id, c.id, false)}>Restore</button>
                {#if app.canDelete(id, c.id)}
                  <button class="icon-btn" aria-label="Delete {c.title || 'Untitled'}" onclick={() => (armed = `del-${c.id}`)}
                    ><Icon name="trash" /></button
                  >
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="note">None.</p>
      {/if}
      {#if b.archived.length}
        <p class="note">Deleting a card removes it, its comments and its files for everyone. Its history stays in Activity.</p>
      {/if}
    </section>

    <section class="danger-zone">
      {#if armed === 'leave'}
        <p>Leave {b.board?.name}? It goes from your devices, and you'd need a new invite to come back.</p>
        <div class="row">
          <button class="btn danger" disabled={busy} onclick={() => act(() => app.leaveBoard(id))}>Leave board</button>
          <button class="btn ghost" onclick={() => (armed = null)}>Stay</button>
        </div>
      {:else if armed === 'delete'}
        <p>Delete {b.board?.name} for everyone? Its cards, comments, files and log go too. This can't be undone.</p>
        <div class="row">
          <button class="btn danger" disabled={busy} onclick={() => act(() => app.deleteBoard(id), 'Board deleted.')}>Delete board</button>
          <button class="btn ghost" onclick={() => (armed = null)}>Keep it</button>
        </div>
      {:else}
        <div class="row">
          <button class="btn" onclick={() => (armed = 'leave')}>Leave board</button>
          {#if admin}<button class="btn danger" onclick={() => (armed = 'delete')}><Icon name="trash" /> Delete board</button>{/if}
        </div>
      {/if}
    </section>
  </main>
{/if}

<style>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: max(12px, env(safe-area-inset-top)) max(var(--px), env(safe-area-inset-right))
      calc(var(--bar-h) + 40px + env(safe-area-inset-bottom)) max(var(--px), env(safe-area-inset-left));
    display: grid;
    gap: 26px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: -10px;
  }
  .crumb {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
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
  h3 {
    margin: 4px 0 0;
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
  .note {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
  }
  .people {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .people li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 10px 10px 14px;
    flex-wrap: wrap;
  }
  .people li + li {
    border-top: 1px solid var(--border);
  }
  .who {
    flex: 1;
    min-width: 140px;
    display: grid;
    overflow-wrap: anywhere;
  }
  .who small {
    color: var(--faint);
    font-size: 12.5px;
  }
  .role {
    width: auto;
    min-height: 40px;
    padding: 6px 8px;
  }
  .ask {
    font-size: 13px;
    color: var(--redT);
  }
  .badge {
    font-size: 12px;
    color: var(--muted);
  }
  .btn.small {
    min-height: 36px;
    padding: 0 12px;
    font-size: 13px;
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .row .field {
    flex: 1;
    min-width: 140px;
  }
  .danger-zone {
    border-top: 1px solid var(--border);
    padding-top: 18px;
  }
  .danger-zone p {
    margin: 0;
  }
</style>
