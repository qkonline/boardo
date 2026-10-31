<script lang="ts">
  import type { FileRec } from '../../shared/model';
  import type { BoardState } from '../lib/board.svelte';
  import { when } from '../lib/dates';
  import { ACCEPT } from '../lib/files.svelte';
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';

  /** A card's files (R4.14 to R4.19): images as thumbnails that open in a viewer, others download. */
  let { b, cardId }: { b: BoardState; cardId: string } = $props();
  const files = $derived(b.filesOn(cardId));
  const waiting = $derived(app.files.queue.filter((u) => u.board === b.id && u.card === cardId));
  const images = $derived(files.filter((f) => f.mime.startsWith('image/')));
  const docs = $derived(files.filter((f) => !f.mime.startsWith('image/')));
  const links = $derived(app.files.links);
  const isAdmin = $derived(app.isAdmin(b.id));

  let picker: HTMLInputElement | null = $state(null);
  let viewing = $state<FileRec | null>(null);
  let armed = $state<string | null>(null);

  $effect(() => {
    if (files.length && app.online) void app.files.ensure(b.id, files.map((f) => f.id));
  });

  // Previews for files still waiting, made here; let go of them when they go.
  const previews = $derived(new Map(waiting.map((u) => [u.id, app.files.localPreview(u)])));
  $effect(() => {
    const p = previews;
    return () => p.forEach((url) => url && URL.revokeObjectURL(url));
  });

  async function chosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const list = [...(input.files ?? [])];
    input.value = '';
    await app.files.add(b.id, cardId, list, b.board?.maxUploadMB ?? 30);
  }

  async function remove(f: FileRec) {
    armed = null;
    if (viewing?.id === f.id) viewing = null;
    try {
      await app.files.remove(b.id, f.id);
    } catch (e) {
      app.say((e as Error).message);
    }
  }

  // The viewer sits inside the card window: it keeps its own keys, so Escape closes only the
  // viewer (not the card) and Tab stays on its keys. Focus goes to it, and back to the thumbnail.
  function holdFocus(node: HTMLElement) {
    const prev = document.activeElement as HTMLElement | null;
    node.querySelector<HTMLElement>('.bar [aria-label=Close]')?.focus({ preventScroll: true });
    return () => {
      if (prev?.isConnected) prev.focus({ preventScroll: true });
    };
  }
  function viewerKeys(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      viewing = null;
      armed = null;
      return;
    }
    if (e.key !== 'Tab') return;
    e.stopPropagation();
    const keys = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('a[href], button')];
    const i = keys.indexOf(document.activeElement as HTMLElement);
    const next = i < 0 ? keys[e.shiftKey ? keys.length - 1 : 0] : keys[(i + (e.shiftKey ? keys.length - 1 : 1)) % keys.length];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
  const ext = (n: string) => n.split('.').pop()?.toUpperCase() ?? '';
  const canRemove = (f: FileRec) => f.by === app.user?.id || isAdmin;
</script>

<section class="files" aria-label="Attachments">
  <div class="head">
    <h3><Icon name="clip" size={16} /> Attachments{#if files.length}<span class="n">{files.length}</span>{/if}</h3>
    <button class="btn small" onclick={() => picker?.click()}><Icon name="clip" /> Attach</button>
    <input bind:this={picker} type="file" multiple accept={ACCEPT} hidden onchange={chosen} />
  </div>

  {#if images.length || waiting.length}
    <div class="grid">
      {#each images as f (f.id)}
        <button class="thumb" onclick={() => (viewing = f)} aria-label="Open {f.name}">
          {#if links[f.id]?.thumb || links[f.id]?.url}
            <img src={links[f.id].thumb ?? links[f.id].url} alt="" loading="lazy" />
          {:else}
            <Icon name="image" size={26} />
          {/if}
        </button>
      {/each}
      {#each waiting as u (u.id)}
        <div class="thumb waiting" title="{u.name}: {app.online ? 'uploading' : 'waiting for a connection'}">
          {#if previews.get(u.id)}<img src={previews.get(u.id)} alt="" />{:else}<Icon name="file" size={26} />{/if}
          <span class="prog" style:width="{Math.round((app.files.progress[u.id] ?? 0) * 100)}%"></span>
          <span class="tag">{app.online ? 'Uploading' : 'Waiting'}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#each docs as f (f.id)}
    <div class="doc">
      <span class="ext">{ext(f.name)}</span>
      <span class="name">
        {#if links[f.id]}<a href={links[f.id].url} download={f.name} rel="noopener">{f.name}</a>{:else}{f.name}{/if}
        <small>{size(f.size)} · {b.member.get(f.by)?.name ?? 'Someone'} · {when(f.at)}</small>
      </span>
      {#if canRemove(f)}
        {#if armed === f.id}
          <button class="btn danger small" onclick={() => remove(f)}>Remove</button>
          <button class="btn ghost small" onclick={() => (armed = null)}>Keep</button>
        {:else}
          <button class="icon-btn" aria-label="Remove {f.name}" onclick={() => (armed = f.id)}><Icon name="trash" /></button>
        {/if}
      {/if}
    </div>
  {/each}

  {#if !files.length && !waiting.length}
    <p class="none">Images, PDFs, CSV and Office files, up to {b.board?.maxUploadMB ?? 30} MB each.</p>
  {/if}
</section>

{#if viewing}
  {@const f = viewing}
  <div class="viewer" role="dialog" aria-modal="true" aria-label={f.name} tabindex="-1" onkeydown={viewerKeys} {@attach holdFocus}>
    <div class="bar">
      <span class="vname">{f.name}</span>
      {#if links[f.id]}<a class="btn small" href={links[f.id].url} download={f.name}>Download</a>{/if}
      {#if canRemove(f)}
        {#if armed === f.id}
          <button class="btn danger small" onclick={() => remove(f)}>Remove</button>
        {:else}
          <button class="icon-btn" aria-label="Remove {f.name}" onclick={() => (armed = f.id)}><Icon name="trash" /></button>
        {/if}
      {/if}
      <button class="icon-btn" aria-label="Close" onclick={() => ((viewing = null), (armed = null))}><Icon name="close" plain /></button>
    </div>
    <button class="stage" onclick={() => ((viewing = null), (armed = null))} aria-label="Close">
      {#if links[f.id]}<img src={links[f.id].url} alt={f.name} />{:else}<span>Connect to see this image.</span>{/if}
    </button>
  </div>
{/if}

<style>
  .files {
    display: grid;
    gap: 10px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    font: 600 13.5px var(--font);
  }
  h3 .n {
    font: 600 11px/1 var(--font);
    color: var(--muted);
    background: var(--sunk);
    border-radius: var(--r-sm);
    padding: 3px 6px;
  }
  .btn.small {
    min-height: 34px;
    padding: 0 10px;
    font-size: 13px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 8px;
  }
  .thumb {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--r-ctl);
    border: 1px solid var(--border);
    background: var(--sunk);
    display: grid;
    place-items: center;
    overflow: hidden;
    padding: 0;
    cursor: pointer;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .waiting {
    cursor: default;
  }
  .waiting img {
    opacity: 0.55;
  }
  .prog {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 4px;
    background: var(--accent);
  }
  .tag {
    position: absolute;
    left: 6px;
    top: 6px;
    font-size: 11px;
    font-weight: 600;
    background: var(--raised);
    border-radius: 4px;
    padding: 2px 5px;
  }
  .doc {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 4px 8px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-ctl);
    background: var(--raised);
  }
  .ext {
    font: 600 11px var(--font);
    width: 40px;
    height: 40px;
    border-radius: var(--r-sm);
    display: grid;
    place-items: center;
    background: var(--tint-indigo);
    color: var(--t-indigo);
    flex: none;
  }
  .name {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    overflow-wrap: anywhere;
    font-size: 14px;
  }
  .name small {
    color: var(--faint);
    font-size: 12px;
  }
  .none {
    margin: 0;
    color: var(--faint);
    font-size: 13px;
  }
  .viewer {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(8, 9, 12, 0.94);
    display: flex;
    flex-direction: column;
    color: #fff;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: max(8px, env(safe-area-inset-top)) 8px 8px 16px;
  }
  .vname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .viewer .icon-btn {
    color: #fff;
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    border: none;
    background: none;
    padding: 8px 8px max(8px, env(safe-area-inset-bottom));
    color: #fff;
    cursor: zoom-out;
  }
  .stage img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
</style>
