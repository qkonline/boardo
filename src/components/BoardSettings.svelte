<script lang="ts">
  import Bell from './Bell.svelte';
  import type { BoardRec, Hue, Role } from '../../shared/model';
  import { call } from '../lib/api';
  import { when } from '../lib/dates';
  import { bgImage } from '../lib/background';
  import { hueColor } from '../lib/hue';
  import type { SettingsTab } from '../lib/route';
  import { app } from '../lib/store.svelte';
  import Avatar from './Avatar.svelte';
  import FieldsEditor from './FieldsEditor.svelte';
  import HuePicker from './HuePicker.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  /**
   * A board's settings, one topic per tab (a side menu on a computer, pills on a phone; each tab
   * has its own address): Look (name, colour, background, scrolling), Cards (what new cards start
   * with, the largest attachment), People (members, roles, invites), Fields, and Leave or delete.
   * Members see People and Leave. Everything in Look and Cards is a draft until the one save bar's
   * Save changes, whichever tab it was made in.
   */
  let { id }: { id: string } = $props();
  const b = $derived(app.data[id]);
  const admin = $derived(app.isAdmin(id));
  const me = $derived(app.user?.id);

  // ---------- tabs ----------

  const TABS: { id: SettingsTab; label: string; icon: IconName; admin: boolean }[] = [
    { id: 'look', label: 'Look', icon: 'image', admin: true },
    { id: 'cards', label: 'Cards', icon: 'boards', admin: true },
    { id: 'people', label: 'People', icon: 'people', admin: false },
    { id: 'fields', label: 'Fields', icon: 'field', admin: true },
    { id: 'leave', label: 'Leave or delete', icon: 'trash', admin: false },
  ];
  const tabs = $derived(TABS.filter((t) => admin || !t.admin));
  const asked = $derived(app.screen.name === 'boardSettings' ? app.screen.tab : undefined);
  const tab = $derived(tabs.find((t) => t.id === asked) ?? tabs[0]);
  const count = (t: SettingsTab) =>
    t === 'people' ? (b?.member.size ?? 0) + invites.length : t === 'fields' ? (b?.fields.length ?? 0) : null;

  // ---------- Look and Cards: drafts, saved together ----------

  // svelte-ignore state_referenced_locally
  let name = $state(b?.board?.name ?? '');
  // svelte-ignore state_referenced_locally
  let hue = $state<Hue>(b?.board?.hue ?? 'indigo');
  // svelte-ignore state_referenced_locally
  let limit = $state(b?.board?.maxUploadMB ?? 30);
  // svelte-ignore state_referenced_locally
  let pageScroll = $state(!!b?.board?.pageScroll);

  // The background: none or a colour is a draft like the rest. An image is uploaded the moment
  // it's picked, since picking the file is the choice; it's the board's only once saved.
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

  // What new cards start with (R3.7). A person who has left, or a status since deleted, shows as
  // Nobody or No status.
  const ncOf = (r: BoardRec | null | undefined) => ({
    assignee: r?.newCards?.assignee && b?.member.has(r.newCards.assignee) ? r.newCards.assignee : '',
    status: r?.newCards?.status && b?.statusField?.options?.some((o) => o.id === r.newCards!.status) ? r.newCards.status : '',
  });
  // svelte-ignore state_referenced_locally
  let ncAssignee = $state(ncOf(b?.board).assignee);
  // svelte-ignore state_referenced_locally
  let ncStatus = $state(ncOf(b?.board).status);

  function reset() {
    if (!b?.board) return;
    name = b.board.name;
    hue = b.board.hue;
    limit = b.board.maxUploadMB;
    pageScroll = !!b.board.pageScroll;
    bgKind = kindOf(b.board);
    bgHue = hueOf(b.board);
    ncAssignee = ncOf(b.board).assignee;
    ncStatus = ncOf(b.board).status;
  }
  $effect(() => {
    if (b?.board) reset();
  });

  /** An image uploaded here and not saved yet, with a preview made from it on this device. */
  let newImage = $state<{ id: string; url: string } | null>(null);
  const dropNew = () => {
    if (newImage) URL.revokeObjectURL(newImage.url);
    newImage = null;
  };
  $effect(() => dropNew);
  const imageId = $derived(newImage?.id ?? bgId);
  const imageUrl = $derived(newImage ? newImage.url : bgId ? app.files.links[bgId]?.url : undefined);
  const draftBg = $derived<BoardRec['background']>(
    bgKind === 'none' ? null : bgKind === 'colour' ? { hue: bgHue } : imageId ? { image: imageId } : (b?.board?.background ?? null),
  );

  const changes = $derived.by(() => {
    const r = b?.board;
    if (!r) return [];
    const out: string[] = [];
    if (name.trim() !== r.name) out.push('Name');
    if (hue !== r.hue) out.push('Colour');
    if (JSON.stringify(draftBg ?? null) !== JSON.stringify(r.background ?? null)) out.push('Background');
    if (pageScroll !== !!r.pageScroll) out.push('Scrolling');
    const nc = ncOf(r);
    if (ncAssignee !== nc.assignee || ncStatus !== nc.status) out.push('New cards');
    if (limit !== r.maxUploadMB) out.push('Largest attachment');
    return out;
  });
  const limitOk = $derived(Number.isFinite(limit) && limit >= 1 && limit <= 100);
  const canSave = $derived(changes.length > 0 && !!name.trim() && limitOk);
  let saving = $state(false);

  async function saveAll() {
    if (!canSave || !b?.board) return;
    saving = true;
    const patch: Partial<BoardRec> = { name: name.trim(), hue, pageScroll };
    if (changes.includes('Background')) patch.background = draftBg ?? null;
    if (changes.includes('New cards'))
      patch.newCards = ncAssignee || ncStatus ? { assignee: ncAssignee || null, status: ncStatus || null } : null;
    if (changes.includes('Largest attachment')) patch.maxUploadMB = Math.round(limit);
    try {
      await app.saveBoard(id, patch);
      dropNew();
    } finally {
      saving = false;
    }
  }
  function discard() {
    dropNew();
    reset();
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
  function chooseImage() {
    if (imageId && bgKind !== 'image') bgKind = 'image';
    else bgPicker?.click();
  }
  function removeImage() {
    dropNew();
    bgKind = 'none';
  }

  // ---------- People ----------

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
  <main class="page" class:saving-room={changes.length > 0}>
    <header class="head">
      <button class="icon-btn back" aria-label="Back to the board" onclick={() => app.go({ name: 'board', id })}><Icon name="back" /></button>
      <div class="titles">
        <p class="crumb">{b.board?.name}</p>
        <h1>Board settings</h1>
      </div>
      <span class="bellat"><Bell where="head" /></span>
    </header>

    <div class="layout">
      <div class="tabs" aria-label="Board settings" role="tablist">
        {#each tabs as t (t.id)}
          {@const n = count(t.id)}
          <button
            role="tab"
            id="tab-{t.id}"
            aria-selected={tab.id === t.id}
            aria-controls="pane"
            class="tab"
            class:out={t.id === 'leave'}
            onclick={() => app.settingsTab(t.id)}
          >
            <Icon name={t.icon} size={18} /><span class="tl">{t.label}</span>{#if n}<span class="n">{n}</span>{/if}
          </button>
        {/each}
      </div>

      <div class="pane" id="pane" role="tabpanel" aria-labelledby="tab-{tab.id}">
        <h2>{tab.label}</h2>

        {#if tab.id === 'look'}
          <div class="part">
            <label class="label" for="bs-name">Name</label>
            <input id="bs-name" class="field" maxlength="100" bind:value={name} />
          </div>
          <div class="part">
            <span class="label">Colour, for the board's square and tile</span>
            <HuePicker bind:value={hue} />
          </div>
          <div class="part">
            <span class="label">Background, behind the columns</span>
            <div class="choices three" role="group" aria-label="Background">
              <button class="choice" aria-pressed={bgKind === 'none'} onclick={() => (bgKind = 'none')}>
                <span class="pv none"></span>
                <span class="ct">None</span>
                <span class="cs">The page's own colour</span>
              </button>
              <button class="choice" aria-pressed={bgKind === 'colour'} onclick={() => (bgKind = 'colour')}>
                <span class="pv" style:background="color-mix(in oklab, {hueColor(bgHue)} 22%, var(--bg))"></span>
                <span class="ct">Colour</span>
                <span class="cs">A tint of a colour you pick</span>
              </button>
              <button
                class="choice"
                aria-pressed={bgKind === 'image'}
                disabled={uploadingBg || (!app.online && !imageId)}
                onclick={chooseImage}
              >
                <span
                  class="pv img"
                  style:background={imageUrl ? `linear-gradient(var(--veil), var(--veil)), center / cover no-repeat url("${imageUrl}")` : undefined}
                  >{#if !imageUrl}<Icon name="image" />{/if}</span
                >
                <span class="ct">{uploadingBg ? 'Uploading…' : 'Image'}</span>
                <span class="cs">{imageId ? 'A picture you uploaded' : 'Pick a picture'}</span>
              </button>
            </div>
            <input bind:this={bgPicker} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onchange={pickBg} />
            {#if bgKind === 'colour'}
              <span class="label sub">Background colour</span>
              <HuePicker bind:value={bgHue} label="Background colour" />
            {:else if bgKind === 'image' && imageId}
              <div class="row">
                <button class="btn" disabled={uploadingBg || !app.online} onclick={() => bgPicker?.click()}><Icon name="image" /> Change image</button>
                <button class="btn remove-bg" onclick={removeImage}><Icon name="trash" /> Remove image</button>
              </div>
            {/if}
            <p class="note">Everyone in the board sees it. Images are made smaller before they're uploaded.</p>
          </div>
          <div class="part">
            <span class="label">Scrolling</span>
            <div class="choices two" role="group" aria-label="Scrolling">
              <button class="choice" aria-pressed={!pageScroll} onclick={() => (pageScroll = false)}>
                <span class="pv mini" aria-hidden="true"
                  ><span class="mcol"><b></b><b></b><b></b></span><span class="mcol"><b></b><b></b></span><span class="mcol"><b></b><b></b><b></b></span></span
                >
                <span class="ct">Each column</span>
                <span class="cs">Each column scrolls on its own, so its name and Add a card stay in view</span>
              </button>
              <button class="choice" aria-pressed={pageScroll} onclick={() => (pageScroll = true)}>
                <span class="pv mini long" aria-hidden="true"
                  ><span class="mcol"><b></b><b></b><b></b><b></b><b></b></span><span class="mcol"><b></b><b></b><b></b><b></b></span><span
                    class="mcol"><b></b><b></b><b></b><b></b><b></b></span
                  ></span
                >
                <span class="ct">Whole page</span>
                <span class="cs">Columns are as long as their cards, and the whole page scrolls</span>
              </button>
            </div>
          </div>
        {:else if tab.id === 'cards'}
          <div class="part">
            <label class="label" for="nc-who">New cards go to</label>
            <select id="nc-who" class="field" bind:value={ncAssignee}>
              <option value="">Nobody</option>
              {#each b.members as m (m.userId)}<option value={m.userId}>{m.name}{m.userId === me ? ' (you)' : ''}</option>{/each}
            </select>
          </div>
          <div class="part">
            <label class="label" for="nc-status">New cards start as</label>
            <select id="nc-status" class="field" bind:value={ncStatus}>
              <option value="">No status</option>
              {#each b.statusField?.options ?? [] as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
            </select>
            <p class="note">Every card added from now on starts with these. Cards already on the board stay as they are.</p>
          </div>
          <div class="part">
            <label class="label" for="bs-limit">Largest attachment</label>
            <div class="unit">
              <input id="bs-limit" class="field" type="number" inputmode="numeric" min="1" max="100" bind:value={limit} />
              <span>MB</span>
            </div>
            <p class="note" class:bad={!limitOk}>Up to 100 MB. The default is 30 MB.</p>
          </div>
        {:else if tab.id === 'people'}
          {#if !admin}<p class="note">Only admins can change the board, its fields and who's in it.</p>{/if}
          <div class="part">
            <span class="label">In the board</span>
            <ul class="card list">
              {#each b.members as m (m.userId)}
                <li>
                  <Avatar person={m} size={36} />
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
          </div>

          {#if admin}
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
              />
              <div class="row">
                <div class="seg" role="group" aria-label="Invite as">
                  <button type="button" aria-pressed={role === 'member'} onclick={() => (role = 'member')}>Member</button>
                  <button type="button" aria-pressed={role === 'admin'} onclick={() => (role = 'admin')}>Admin</button>
                </div>
                <button class="key ink" type="submit" disabled={inviting || !email.trim() || !app.online}><Icon name="mail" plain /> Send invite</button>
              </div>
              <p class="note">They get an email with a link, and join once they sign in with that address. Invites work for 14 days.</p>
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
                      <button class="btn small danger" disabled={busy} onclick={() => act(() => call('/invites/revoke', { id: inv.id }).then(loadInvites))}
                        >Cancel</button
                      >
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          {/if}
        {:else if tab.id === 'fields'}
          <p class="note">Every card in this board has these. Members fill them in; only admins change them.</p>
          <FieldsEditor {b} />
        {:else if tab.id === 'leave'}
          <div class="card out-card">
            <div class="what">
              <b>Leave {b.board?.name}</b>
              <span>It goes from your devices, and you'd need a new invite to come back.</span>
            </div>
            {#if armed === 'leave'}
              <div class="row">
                <button class="btn danger" disabled={busy} onclick={() => act(() => app.leaveBoard(id))}>Leave board</button>
                <button class="btn ghost" onclick={() => (armed = null)}>Stay</button>
              </div>
            {:else}
              <button class="btn" onclick={() => (armed = 'leave')}>Leave board</button>
            {/if}
          </div>
          {#if admin}
            <div class="card out-card">
              <div class="what">
                <b>Delete {b.board?.name}</b>
                <span>For everyone, with its cards, comments, files and log. This can't be undone.</span>
              </div>
              {#if armed === 'delete'}
                <div class="row">
                  <button class="btn danger" disabled={busy} onclick={() => act(() => app.deleteBoard(id), 'Board deleted.')}>Delete board</button>
                  <button class="btn ghost" onclick={() => (armed = null)}>Keep it</button>
                </div>
              {:else}
                <button class="btn danger" onclick={() => (armed = 'delete')}><Icon name="trash" /> Delete board</button>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </div>

    {#if changes.length}
      <!-- One bar for everything not saved yet, from whichever tab. -->
      <div class="save-row" role="region" aria-label="Changes not saved">
        <div class="save-in">
          <span class="unsaved">Not saved yet: {changes.join(', ')}</span>
          <button class="key" disabled={saving} onclick={discard}>Discard</button>
          <button class="key ink" disabled={!canSave || saving} onclick={saveAll}>Save changes</button>
        </div>
      </div>
    {/if}
  </main>
{/if}

<style>
  .page {
    max-width: 1040px;
    margin: 0 auto;
    padding: max(12px, env(safe-area-inset-top)) max(var(--px), env(safe-area-inset-right))
      calc(var(--bar-h) + 40px + env(safe-area-inset-bottom)) max(var(--px), env(safe-area-inset-left));
    box-sizing: border-box;
  }
  .page.saving-room {
    padding-bottom: calc(var(--bar-h) + 120px + env(safe-area-inset-bottom));
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 18px -10px;
  }
  .titles {
    min-width: 0;
  }
  .bellat {
    margin-left: auto;
  }
  .crumb {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
  }

  /* A side menu on a computer; a row of pills on a phone. */
  .layout {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 36px;
    align-items: start;
  }
  .tabs {
    display: flex;
    flex-direction: column;
    gap: 2px;
    position: sticky;
    top: 76px;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 42px;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: var(--r-ctl);
    background: none;
    color: var(--muted);
    font: 500 15px var(--font);
    text-align: left;
    cursor: pointer;
  }
  @media (hover: hover) {
    .tab:hover {
      color: var(--text);
    }
  }
  .tab[aria-selected='true'] {
    background: var(--raised);
    border-color: var(--border);
    color: var(--text);
  }
  .tab.out {
    margin-top: 18px;
    color: var(--redT);
  }
  .tab .n {
    margin-left: auto;
    color: var(--faint);
    font-size: 12.5px;
  }
  .pane {
    display: grid;
    gap: 24px;
    max-width: 640px;
    min-width: 0;
  }
  h2 {
    margin: 4px 0 0;
    font-size: 20px;
    font-weight: 600;
  }
  .part {
    display: grid;
    gap: 8px;
    margin: 0;
  }
  .label.sub {
    margin-top: 6px;
  }
  .note {
    margin: 0;
    color: var(--muted);
    font-size: 13.5px;
  }
  .note.bad {
    color: var(--redT);
  }

  /* Choices shown as small pictures: the background, and how the board scrolls. */
  .choices {
    display: grid;
    gap: 12px;
  }
  .choices.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .choices.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .choice {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--raised);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .choice[aria-pressed='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .choice:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .pv {
    height: 72px;
    border-radius: var(--r-ctl);
    display: grid;
    place-items: center;
  }
  .pv.none {
    background: var(--bg);
    border: 1px dashed var(--line);
    box-sizing: border-box;
  }
  .pv.img {
    background: var(--sunk);
  }
  .pv.mini {
    display: flex;
    gap: 6px;
    padding: 8px;
    box-sizing: border-box;
    height: 84px;
    background: var(--bg);
    overflow: hidden;
    align-items: flex-start;
  }
  .mcol {
    flex: 1;
    display: grid;
    gap: 4px;
    padding: 4px;
    border-radius: 4px;
    background: var(--sunk);
  }
  .mini:not(.long) .mcol {
    max-height: 48px;
    overflow: hidden;
  }
  .mcol b {
    height: 10px;
    border-radius: 2px;
    background: var(--line);
  }
  .ct {
    padding: 0 4px;
    font-size: 14.5px;
    font-weight: 500;
  }
  .cs {
    padding: 0 4px;
    color: var(--muted);
    font-size: 12.5px;
    line-height: 1.35;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .remove-bg {
    color: var(--redT);
    border-color: color-mix(in oklab, var(--rose) 35%, var(--border));
  }
  .unit {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 200px;
  }
  .unit span {
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
  .role {
    width: auto;
    min-height: 40px;
    padding: 6px 8px;
  }
  .badge {
    padding: 4px 8px;
    border-radius: var(--r-sm);
    background: var(--sunk);
    color: var(--muted);
    font-size: 12.5px;
  }
  .btn.small {
    min-height: 36px;
    padding: 0 12px;
    font-size: 13px;
  }
  .out-card {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
    padding: 14px 16px;
  }
  .what {
    flex: 1;
    min-width: 220px;
    display: grid;
    gap: 3px;
  }
  .what span {
    color: var(--muted);
    font-size: 13.5px;
  }

  /* The save bar: at the foot of the window, lined up with the tab's content. */
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
    max-width: 1040px;
    margin: 0 auto;
    box-sizing: border-box;
    padding: 12px max(var(--px), env(safe-area-inset-right)) 12px calc(max(var(--px), env(safe-area-inset-left)) + 256px);
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
  @media (max-width: 767px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 18px;
    }
    .tabs {
      position: static;
      flex-direction: row;
      gap: 6px;
      margin: 0 calc(-1 * max(var(--px), env(safe-area-inset-left)));
      padding: 0 max(var(--px), env(safe-area-inset-left)) 4px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tab {
      flex: none;
      min-height: 40px;
      padding: 0 14px;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--raised);
      font-size: 14px;
    }
    .tab :global(svg) {
      display: none;
    }
    .tab[aria-selected='true'] {
      background: var(--text);
      border-color: var(--text);
      color: var(--bg);
    }
    .tab[aria-selected='true'] .n {
      color: var(--bg);
      opacity: 0.7;
    }
    .tab .n {
      margin-left: 2px;
    }
    .tab.out {
      margin-top: 0;
    }
    .save-in {
      padding-left: max(var(--px), env(safe-area-inset-left));
    }
  }
  /* On a narrow phone the three backgrounds stay in a row: just their pictures and names. */
  @media (max-width: 480px) {
    .choices {
      gap: 8px;
    }
    .three .cs {
      display: none;
    }
    .three .pv {
      height: 60px;
    }
  }
</style>
