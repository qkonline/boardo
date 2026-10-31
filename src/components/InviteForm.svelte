<script module lang="ts">
  import type { Role } from '../../shared/model';
  import { call } from '../lib/api';

  export type Waiting = { id: string; email: string; role: Role; created: number; expires: number };
  /** The invites waiting in a board (admins only), or null when they can't be fetched. */
  export async function waitingInvites(board: string): Promise<Waiting[] | null> {
    try {
      return (await call<{ invites: Waiting[] }>('/invites', { board })).invites;
    } catch {
      return null;
    }
  }
</script>

<script lang="ts">
  import { when } from '../lib/dates';
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';

  /**
   * Inviting someone to a board (admins), and the invites waiting: in Board settings' People, and
   * in the sheet the board's Invite key opens.
   */
  let { id, autofocus = false, invites = $bindable([]) }: { id: string; autofocus?: boolean; invites?: Waiting[] } = $props();

  let email = $state('');
  let role = $state<Role>('member');
  let inviting = $state(false);
  let busy = $state(false);

  async function loadInvites() {
    if (!app.online) return;
    const got = await waitingInvites(id);
    if (got) invites = got;
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

<form class="part" onsubmit={invite}>
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
    data-autofocus={autofocus ? '' : undefined}
  />
  <div class="row">
    <div class="seg" role="group" aria-label="Invite as">
      <button type="button" aria-pressed={role === 'member'} onclick={() => (role = 'member')}>Member</button>
      <button type="button" aria-pressed={role === 'admin'} onclick={() => (role = 'admin')}>Admin</button>
    </div>
    <button class="key ink" type="submit" disabled={inviting || !email.trim() || !app.online}><Icon name="mail" plain /> Send invite</button>
  </div>
  <p class="note">
    {app.online
      ? 'They get an email with a link, and join once they sign in with that address. Invites work for 14 days.'
      : 'Connect to send an invite.'}
  </p>
</form>
{#if invites.length}
  <div class="part">
    <span class="label">Waiting to join</span>
    <ul class="card list">
      {#each invites as inv (inv.id)}
        <li>
          <span class="who"><b>{inv.email}</b><small>{inv.role === 'admin' ? 'Admin' : 'Member'}, sent {when(inv.created)}</small></span>
          <button
            class="btn small"
            disabled={busy}
            onclick={() => act(() => call('/invites/resend', { id: inv.id }).then(loadInvites), 'Invite sent again.')}>Resend</button
          >
          <button
            class="btn small danger"
            disabled={busy}
            onclick={() => act(() => call('/invites/revoke', { id: inv.id }).then(loadInvites), 'Invite cancelled.')}>Cancel invite</button
          >
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .part {
    display: grid;
    gap: 8px;
    margin: 0;
  }
  .note {
    margin: 0;
    color: var(--muted);
    font-size: 13.5px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .seg {
    display: flex;
    background: var(--sunk);
    border-radius: var(--r-ctl);
    padding: 3px;
    gap: 2px;
  }
  .seg button {
    border: none;
    background: transparent;
    color: var(--muted);
    font: 500 14px var(--font);
    min-height: 36px;
    padding: 0 14px;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .seg button[aria-pressed='true'] {
    background: var(--raised);
    color: var(--text);
    box-shadow: 0 1px 0 var(--line);
  }
  .card {
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    min-height: 60px;
    padding: 8px 10px 8px 14px;
    box-sizing: border-box;
  }
  .list li + li {
    border-top: 1px solid var(--border);
  }
  .who {
    flex: 1;
    min-width: 140px;
    display: grid;
    gap: 1px;
    overflow-wrap: anywhere;
  }
  .who small {
    color: var(--muted);
    font-size: 12.5px;
  }
  .btn.small {
    min-height: 36px;
    padding: 0 12px;
    font-size: 13px;
  }
  @media (pointer: coarse) {
    .seg button,
    .btn.small {
      min-height: 44px;
    }
  }
</style>
