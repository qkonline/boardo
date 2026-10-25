<script lang="ts">
  import Bell from './Bell.svelte';
  import type { BoardRec, Hue, Role } from '../../shared/model';
  import { call } from '../lib/api';
  import { when } from '../lib/dates';
  import { bgImage, tileBackground } from '../lib/background';
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

  // The background: none or a colour is part of the Board draft, saved with Save. An image is
  // uploaded the moment it's picked, since picking the file is the choice.
  const bgId = $derived(bgImage(b?.board));
  $effect(() => {
    if (bgId && app.online) void app.files.ensure(id, [bgId]);
  });
  type BgKind = 'none' | 'colour' | 'image';
  const kindOf = (r: BoardRec | null | undefined): BgKind => (!r?.background ? 'none' : 'image' in r.background ? 'image' : 'colour');
  const hueOf = (r: BoardRec | null | undefined): Hue => (r?.background && 'hue' in r.background ? r.background.hue : r?.hue) ?? 'indigo';
  // svelte-ignore state_referenced_locally
  let bgKind = $state<BgKind>(kindOf(b?.board));
  // svelte-ignore state_referenced_locally
  let bgHue = $state<Hue>(hueOf(b?.board));

  // What new cards start with (admins, R3.7): a draft of its own, kept until its Save. A person
  // who has left the board, or a status since deleted, shows as Nobody or None.
  const ncOf = (r: BoardRec | null | undefined) => ({
    assignee: r?.newCards?.assignee && b?.member.has(r.newCards.assignee) ? r.newCards.assignee : '',
    status: r?.newCards?.status && b?.statusField?.options?.some((o) => o.id === r.newCards!.status) ? r.newCards.status : '',
  });
  // svelte-ignore state_referenced_locally
  let ncAssignee = $state(ncOf(b?.board).assignee);
  // svelte-ignore state_referenced_locally
  let ncStatus = $state(ncOf(b?.board).status);
  const ncChanged = $derived(!!b?.board && (ncAssignee !== ncOf(b.board).assignee || ncStatus !== ncOf(b.board).status));
  async function saveNewCards() {
    await app.saveBoard(id, { newCards: ncAssignee || ncStatus ? { assignee: ncAssignee || null, status: ncStatus || null } : null });
  }

  $effect(() => {
    if (b?.board) {
      name = b.board.name;
      hue = b.board.hue;
      limit = b.board.maxUploadMB;
      bgKind = kindOf(b.board);
      bgHue = hueOf(b.board);
      ncAssignee = ncOf(b.board).assignee;
      ncStatus = ncOf(b.board).status;
    }
  });
  /** An image uploaded here and not saved yet, with a preview made from it on this device. */
  let newImage = $state<{ id: string; url: string } | null>(null);
  const dropNew = () => {
    if (newImage) URL.revokeObjectURL(newImage.url);
    newImage = null;
  };
  $effect(() => dropNew);
  const imageId = $derived(newImage?.id ?? bgId);
  const draftBg = $derived<BoardRec['background']>(
    bgKind === 'none' ? null : bgKind === 'colour' ? { hue: bgHue } : imageId ? { image: imageId } : (b?.board?.background ?? null),
  );
  const bgChanged = $derived(!!b?.board && JSON.stringify(draftBg ?? null) !== JSON.stringify(b.board.background ?? null));
  const changed = $derived(!!b?.board && (name.trim() !== b.board.name || hue !== b.board.hue || bgChanged));
  const previewUrl = $derived(bgKind !== 'image' ? undefined : newImage ? newImage.url : bgId ? app.files.links[bgId]?.url : undefined);

  async function saveSection() {
    const patch: Partial<BoardRec> = { name: name.trim(), hue };
    if (bgChanged) patch.background = draftBg ?? null;
    await app.saveBoard(id, patch);
    dropNew();
  }
  function removeImage() {
    dropNew();
    bgKind = 'none';
  }
  let bgPicker: HTMLInputElement | null = $state(null);
  let uploadingBg = $state(false);
  async function pickBg(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    uploadingBg = true;
    try {
      const up = await app.uploadBackground(id, f);
      dropNew();
      newImage = { id: up.id, url: URL.createObjectURL(up.image) };
      bgKind = 'image';
    } catch (err) {
      app.say((err as Error).message);
    } finally {
      uploadingBg = false;
    }
  }

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
      <span class="bellat"><Bell where="head" /></span>
    </header>

    <section>
      <h2>Board</h2>
      {#if admin}
        <div class="card form">
          <label class="label" for="bs-name">Name</label>
          <input id="bs-name" class="field" maxlength="100" bind:value={name} />
          <span class="label">Colour</span>
          <HuePicker bind:value={hue} />
          <div class="bg-part">
            <span class="label">Background</span>
            <div
              class="bg-preview"
              style:background={tileBackground(b.board && { ...b.board, background: draftBg ?? null }, hue, previewUrl)}
            >
              <span>{bgKind === 'none' ? 'No background' : bgKind === 'image' ? 'Image' : 'Colour'}</span>
              {#if bgKind === 'image' && imageId}
                <button class="btn remove-bg" onclick={removeImage}><Icon name="trash" /> Remove image</button>
              {/if}
            </div>
            <div class="seg" role="group" aria-label="Background">
              <button aria-pressed={bgKind === 'none'} onclick={() => (bgKind = 'none')}>None</button>
              <button aria-pressed={bgKind === 'colour'} onclick={() => (bgKind = 'colour')}>Colour</button>
              <button
                aria-pressed={bgKind === 'image'}
                disabled={uploadingBg || (!app.online && !(imageId && bgKind !== 'image'))}
                onclick={() => (imageId && bgKind !== 'image' ? (bgKind = 'image') : bgPicker?.click())}
                >{uploadingBg ? 'Uploading…' : imageId && bgKind === 'image' ? 'Change image' : 'Image'}</button
              >
            </div>
            <input bind:this={bgPicker} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onchange={pickBg} />
            {#if bgKind === 'colour'}
              <span class="label">Colour</span>
              <HuePicker bind:value={bgHue} label="Background colour" />
            {/if}
            <p class="note">Everyone in the board sees it. Images are made smaller before they're uploaded.</p>
          </div>
          <div class="save-row">
            <button class="key ink" disabled={!changed || !name.trim()} onclick={saveSection}>Save</button>
            {#if changed}<span class="unsaved">Not saved yet. The board shows the change once you save.</span>{/if}
          </div>
        </div>
      {:else}
        <p class="note">Only admins can change the board, its fields and who's in it.</p>
      {/if}
    </section>

    {#if admin}
      <section class="new-cards">
        <h2>New cards</h2>
        <div class="card form">
          <label class="label" for="nc-who">Assign to</label>
          <select id="nc-who" class="field" bind:value={ncAssignee}>
            <option value="">Nobody</option>
            {#each b.members as m (m.userId)}<option value={m.userId}>{m.name}{m.userId === me ? ' (you)' : ''}</option>{/each}
          </select>
          <label class="label" for="nc-status">Status</label>
          <select id="nc-status" class="field" bind:value={ncStatus}>
            <option value="">None</option>
            {#each b.statusField?.options ?? [] as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
          </select>
          <p class="note">Every card added from now on starts with these. Cards already on the board stay as they are.</p>
          <div class="save-row">
            <button class="key ink" disabled={!ncChanged} onclick={saveNewCards}>Save</button>
            {#if ncChanged}<span class="unsaved">Not saved yet. New cards follow it once you save.</span>{/if}
          </div>
        </div>
      </section>
    {/if}

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
  .bellat {
    margin-left: auto;
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
  .bg-part {
    display: grid;
    gap: 8px;
    margin-top: 10px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
  .bg-preview {
    height: 96px;
    border-radius: var(--r-ctl);
    border: 1px solid var(--border);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
  }
  .remove-bg {
    min-height: 36px;
    padding: 0 10px;
    font-size: 13px;
    color: var(--redT);
    background: var(--raised);
    border-color: color-mix(in oklab, var(--rose) 35%, var(--border));
  }
  @media (pointer: coarse) {
    .remove-bg {
      min-height: 44px;
    }
  }
  .save-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  .unsaved {
    color: var(--muted);
    font-size: 13px;
  }
  .bg-preview span {
    font: 600 12px var(--font);
    background: var(--raised);
    color: var(--text);
    border-radius: var(--r-sm);
    padding: 3px 7px;
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
    min-height: 40px;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .seg button[aria-pressed='true'] {
    background: var(--raised);
    color: var(--text);
    box-shadow: 0 1px 0 var(--line);
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
