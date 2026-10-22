<script lang="ts">
  import type { BoardState } from '../lib/board.svelte';
  import { when } from '../lib/dates';
  import { app } from '../lib/store.svelte';
  import { EMOJI, linkify } from '../lib/text';
  import Avatar from './Avatar.svelte';
  import Balloon from './Balloon.svelte';
  import Icon from './Icon.svelte';

  /** A card's comments (R4.10 to R4.13): plain text with emoji, editable by their author only. */
  let { b, cardId }: { b: BoardState; cardId: string } = $props();
  const list = $derived(b.commentsOn(cardId));

  let text = $state('');
  let picker = $state(false);
  let box: HTMLTextAreaElement | null = $state(null);
  let editing = $state<string | null>(null);
  let editText = $state('');
  let armed = $state<string | null>(null);

  async function post(e?: Event) {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    text = '';
    picker = false;
    await app.addComment(b.id, cardId, t);
  }

  function insert(emoji: string) {
    const el = box;
    if (!el) {
      text += emoji;
      return;
    }
    const s = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    text = text.slice(0, s) + emoji + text.slice(end);
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(s + emoji.length, s + emoji.length);
    });
  }

  async function saveEdit(id: string) {
    const t = editText.trim();
    editing = null;
    if (t) await app.editComment(b.id, id, t);
  }
</script>

<section class="comments" aria-label="Comments">
  <h3><Icon name="chat" size={16} /> Comments{#if list.length}<span class="n">{list.length}</span>{/if}</h3>
  {#each list as c (c.id)}
    {@const who = b.member.get(c.userId)}
    {@const mine = c.userId === app.user?.id}
    <div class="c">
      <Avatar person={who} size={28} />
      <div class="body">
        <div class="by">
          <b>{who?.name ?? 'Someone who left'}</b>
          <span class="when">{when(c.at)}{c.editedAt ? ', edited' : ''}</span>
        </div>
        {#if editing === c.id}
          <textarea class="field" rows="3" bind:value={editText} maxlength="5000"></textarea>
          <div class="row">
            <button class="key ink" disabled={!editText.trim()} onclick={() => saveEdit(c.id)}>Save</button>
            <button class="btn ghost" onclick={() => (editing = null)}>Cancel</button>
          </div>
        {:else}
          <p class="text">
            {#each linkify(c.text) as p, i (i)}{#if p.href}<a href={p.href} target="_blank" rel="noopener noreferrer nofollow"
                  >{p.text}</a
                >{:else}{p.text}{/if}{/each}
          </p>
          {#if mine}
            <div class="mine">
              {#if armed === c.id}
                <span class="ask">Delete this comment?</span>
                <button class="btn danger" onclick={() => ((armed = null), app.deleteComment(b.id, c.id))}>Delete</button>
                <button class="btn ghost" onclick={() => (armed = null)}>Keep</button>
              {:else}
                <button class="link" onclick={() => ((editing = c.id), (editText = c.text))}>Edit</button>
                <button class="link" onclick={() => (armed = c.id)}>Delete</button>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/each}

  <form class="compose" onsubmit={post}>
    <textarea
      class="field"
      rows="2"
      placeholder="Write a comment"
      aria-label="Write a comment"
      maxlength="5000"
      bind:value={text}
      bind:this={box}
      onkeydown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post();
      }}
    ></textarea>
    <div class="tools">
      <!-- Emoji in a balloon over the page, so nothing moves when it opens. -->
      <Balloon bind:open={picker} label="Emoji" place="above" align="start">
        {#snippet trigger({ toggle, open })}
          <button type="button" class="icon-btn emoji-btn" aria-label="Emoji" aria-expanded={open} onclick={toggle}
            ><Icon name="smile" size={22} /></button
          >
        {/snippet}
        {#snippet children()}
          <div class="picker" role="group" aria-label="Emoji">
            {#each EMOJI as e (e)}
              <button type="button" class="em" onclick={() => insert(e)} aria-label={e}>{e}</button>
            {/each}
          </div>
        {/snippet}
      </Balloon>
      <button class="key ink post" type="submit" disabled={!text.trim()}><Icon name="send" plain /> Comment</button>
    </div>
  </form>
</section>

<style>
  .comments {
    display: grid;
    gap: 14px;
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
  .c {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: 10px;
  }
  .body {
    min-width: 0;
    display: grid;
    gap: 4px;
  }
  .by {
    display: flex;
    gap: 8px;
    align-items: baseline;
    flex-wrap: wrap;
    font-size: 14px;
  }
  .when {
    color: var(--faint);
    font-size: 12.5px;
  }
  .text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .mine {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .link {
    border: none;
    background: none;
    padding: 4px 0;
    min-height: 32px;
    color: var(--muted);
    font: 500 13px var(--font);
    cursor: pointer;
  }
  .ask {
    font-size: 13px;
  }
  .compose {
    display: grid;
    gap: 8px;
  }
  /* One box: the text, with the emoji balloon and Comment along its foot. */
  .compose {
    border: 1px solid var(--line);
    border-radius: var(--r-ctl);
    background: var(--raised);
    gap: 0;
  }
  .compose:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: transparent;
  }
  .compose textarea {
    min-height: 56px;
    border: none;
    background: transparent;
    resize: none;
  }
  .compose textarea:focus {
    outline: none;
  }
  .tools {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 6px 6px 4px;
  }
  .post {
    min-height: 36px;
    padding: 0 14px;
    font-size: 13.5px;
  }
  .row {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    align-items: center;
  }
  .picker {
    display: grid;
    grid-template-columns: repeat(8, 36px);
    gap: 2px;
  }
  @media (max-width: 420px) {
    .picker {
      grid-template-columns: repeat(6, 40px);
    }
  }
  .em {
    min-height: 38px;
    border: none;
    background: none;
    font-size: 22px;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  @media (hover: hover) {
    .em:hover {
      background: var(--sunk);
    }
  }
</style>
