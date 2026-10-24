<script lang="ts">
  import { EMOJI_GROUPS, noteEmoji, recentEmoji } from '../lib/emoji';

  /**
   * The emoji for a comment, in groups (emoji.ts) with the ones used lately on this device
   * first. A row of tabs jumps to a group; the grid scrolls inside the balloon it opens in.
   */
  let { onpick }: { onpick: (e: string) => void } = $props();

  const recent = recentEmoji();
  const groups = recent.length ? [{ id: 'recent', name: 'Recent', list: recent }, ...EMOJI_GROUPS] : EMOJI_GROUPS;
  let grid: HTMLElement | null = $state(null);
  let current = $state(groups[0].id);

  function jump(id: string) {
    const h = grid?.querySelector<HTMLElement>(`[data-group="${id}"]`);
    if (h && grid) grid.scrollTo({ top: h.offsetTop - grid.offsetTop, behavior: 'smooth' });
    current = id;
  }
  /** The tab follows the group in view. */
  function follow() {
    if (!grid) return;
    let id = groups[0].id;
    for (const h of grid.querySelectorAll<HTMLElement>('[data-group]')) if (h.offsetTop - grid.offsetTop <= grid.scrollTop + 8) id = h.dataset.group!;
    current = id;
  }
  function pick(e: string) {
    noteEmoji(e);
    onpick(e);
  }
</script>

<div class="emoji" role="group" aria-label="Emoji">
  <div class="tabs" role="tablist" aria-label="Emoji groups">
    {#each groups as gr (gr.id)}
      <button
        type="button"
        role="tab"
        aria-selected={current === gr.id}
        aria-label={gr.name}
        title={gr.name}
        onclick={() => jump(gr.id)}>{gr.id === 'recent' ? '🕘' : gr.list[0]}</button
      >
    {/each}
  </div>
  <div class="grid" bind:this={grid} onscroll={follow}>
    {#each groups as gr (gr.id)}
      <p class="name" data-group={gr.id}>{gr.name}</p>
      <div class="list">
        {#each gr.list as e, i (i)}
          <button type="button" class="em" onclick={() => pick(e)} aria-label={e}>{e}</button>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .emoji {
    width: min(306px, calc(86vw - 14px));
    display: grid;
    gap: 6px;
  }
  .tabs {
    display: flex;
    justify-content: space-between;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--r-sm);
    background: none;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    opacity: 0.55;
  }
  .tabs button[aria-selected='true'] {
    opacity: 1;
    background: var(--tint-indigo);
  }
  .grid {
    position: relative;
    max-height: 248px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .name {
    margin: 0;
    padding: 6px 4px 4px;
    font: 600 12px/1 var(--font);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  }
  .em {
    height: 40px;
    padding: 0;
    border: none;
    background: none;
    font-size: 23px;
    line-height: 1;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  @media (hover: hover) {
    .em:hover,
    .tabs button:hover {
      background: var(--sunk);
      opacity: 1;
    }
  }
</style>
