<script lang="ts">
  import type { BoardState } from '../lib/board.svelte';
  import { when } from '../lib/dates';
  import { app } from '../lib/store.svelte';
  import Avatar from './Avatar.svelte';
  import Balloon from './Balloon.svelte';
  import EmojiPicker from './EmojiPicker.svelte';
  import FormatBar, { formatKey } from './FormatBar.svelte';
  import Icon from './Icon.svelte';
  import MentionPicker from './MentionPicker.svelte';
  import PersonLink from './PersonLink.svelte';
  import Rich from './Rich.svelte';

  /** A card's comments (R4.10 to R4.13): text with emoji and light formatting, editable by their author only. */
  let { b, cardId }: { b: BoardState; cardId: string } = $props();
  const list = $derived(b.commentsOn(cardId));

  let text = $state('');
  let picker = $state(false);
  let box: HTMLTextAreaElement | null = $state(null);
  let editing = $state<string | null>(null);
  let editText = $state('');
  let editBox: HTMLTextAreaElement | null = $state(null);
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
      <PersonLink person={who} {b}><Avatar person={who} size={28} /></PersonLink>
      <div class="body">
        <div class="by">
          <PersonLink person={who} {b}><b>{who?.name ?? 'Someone who left'}</b></PersonLink>
          <span class="when">{when(c.at)}{c.editedAt ? ', edited' : ''}</span>
        </div>
        {#if editing === c.id}
          <div class="editor">
            <FormatBar el={editBox} />
            <textarea
              class="field"
              rows="3"
              aria-label="Edit the comment"
              bind:value={editText}
              bind:this={editBox}
              onkeydown={(e) => editBox && formatKey(editBox, e)}
              maxlength="5000"
            ></textarea>
            <MentionPicker el={editBox} people={b.members} />
          </div>
          <div class="row">
            <button class="key ink" disabled={!editText.trim()} onclick={() => saveEdit(c.id)}>Save</button>
            <button class="btn ghost" onclick={() => (editing = null)}>Cancel</button>
          </div>
        {:else}
          <div class="text"><Rich text={c.text} {b} /></div>
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
    <FormatBar el={box} />
    <textarea
      class="field"
      rows="2"
      placeholder="Write a comment. Type @ to mention someone."
      aria-label="Write a comment"
      maxlength="5000"
      bind:value={text}
      bind:this={box}
      onkeydown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post();
        else if (box) formatKey(box, e);
      }}
    ></textarea>
    <MentionPicker el={box} people={b.members} />
    <div class="tools">
      <!-- Emoji in a balloon over the page, so nothing moves when it opens. -->
      <Balloon bind:open={picker} label="Emoji" place="above" align="start">
        {#snippet trigger({ toggle, open })}
          <button type="button" class="icon-btn emoji-btn" aria-label="Emoji" aria-expanded={open} onclick={toggle}
            ><Icon name="smile" size={22} /></button
          >
        {/snippet}
        {#snippet children()}
          <EmojiPicker onpick={insert} />
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
    color: var(--muted);
    font-size: 12.5px;
  }
  .text {
    overflow-wrap: anywhere;
  }
  /* The comment box and the edit box: formatting keys along the top, a hairline under them. */
  .compose :global(.bar),
  .editor :global(.bar) {
    border-bottom: 1px solid var(--border);
  }
  .editor {
    border: 1px solid var(--field-edge);
    border-radius: var(--r-ctl);
    background: var(--raised);
  }
  .editor:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: transparent;
  }
  .editor textarea {
    border: none;
    background: transparent;
    resize: none;
  }
  .editor textarea:focus {
    outline: none;
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
    border: 1px solid var(--field-edge);
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
  @media (pointer: coarse) {
    .post {
      min-height: 44px;
    }
    /* Edit and Delete under a comment: a 44px tap area without spacing the comments apart. */
    .link {
      position: relative;
    }
    .link::after {
      content: '';
      position: absolute;
      inset: -6px -6px;
    }
  }
</style>
