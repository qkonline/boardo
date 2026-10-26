<script lang="ts">
  import type { CardRec, FieldOption, FieldRec, MemberRec } from '../../shared/model';
  import { statusOption } from '../../shared/rules';
  import type { BoardState } from '../lib/board.svelte';
  import { deadline, range } from '../lib/dates';
  import { drag } from '../lib/drag.svelte';
  import { fieldText } from '../lib/fields';
  import { plain } from '../lib/format';
  import { highlight, nameMatches, snippet, type Hit } from '../lib/search';
  import { app } from '../lib/store.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import StatusChip from './StatusChip.svelte';

  /**
   * A card in a column: the title, then one row with its status (when it has one), its dates and
   * counts, and who's on it, a green tick on each person whose part is done.
   */
  let {
    card,
    b,
    showBoard = false,
    hit,
    words = [],
  }: {
    card: CardRec;
    b: BoardState;
    showBoard?: boolean;
    /** While searching the board (R3.6a): where this card matched, and the words, to mark them. */
    hit?: Hit;
    words?: string[];
  } = $props();

  const status = $derived(statusOption(card, b.statusField));
  const completed = $derived(status?.role === 'completed');
  const due = $derived(completed ? null : deadline(card.values.end ?? card.values.start));
  const dates = $derived(range(card.values.start, card.values.end));
  const comments = $derived(b.commentsOn(card.id).length);
  const files = $derived(b.filesOn(card.id).length);
  const doneCount = $derived(card.assignees.filter((u) => card.done[u] != null).length);
  /**
   * The custom fields the board's admins chose to show on cards (R4.9a), with a value here: a
   * dropdown as its coloured chip, like the status; anything else as a grey chip with its name.
   */
  type Shown = { f: FieldRec; text: string; opt?: FieldOption; person?: MemberRec; tick?: boolean };
  const extra = $derived(
    b.fields
      .filter((f) => f.onCard && !f.builtin)
      .flatMap((f): Shown[] => {
        const v = card.values[f.id];
        if (v == null || v === '' || v === false) return [];
        if (f.type === 'dropdown') {
          const opt = f.options?.find((o) => o.id === v);
          return opt ? [{ f, opt, text: `${f.name}: ${opt.label}` }] : [];
        }
        if (f.type === 'person') {
          const person = b.member.get(String(v));
          return [{ f, person, text: person?.name ?? 'Someone who left' }];
        }
        if (f.type === 'checkbox') return [{ f, tick: true, text: f.name }];
        return [{ f, text: `${f.name}: ${fieldText(f, v)}` }];
      }),
  );
  /** A hint that there's a description to read: its first words, up to two lines. */
  const preview = $derived(card.desc ? plain(card.desc).slice(0, 240) : '');
  // While searching: the title and preview with the words marked, and, when the title doesn't have
  // them all, the piece that does (a comment, a field, a file, the description) in place of the preview.
  const title = $derived(highlight(card.title || 'Untitled', words));
  const found = $derived(
    hit?.part && !nameMatches(card.title, words)
      ? { label: hit.part.where === 'desc' ? '' : `${hit.part.where === 'comment' ? hit.part.label.replace(/^Comment by /, '') : hit.part.label}: `, pieces: snippet(hit.part.text, words, 120) }
      : null,
  );

  function open() {
    if (drag.justDropped) return;
    app.openCard(b.id, card.id);
  }
</script>

<button
  class="card"
  class:lifted={drag.card === card.id}
  class:completed
  data-card={card.id}
  onclick={open}
  aria-label="{card.title || 'Untitled'}{status ? `, ${status.label}` : ''}{due ? `, ${due.label}` : ''}{card.assignees.length > 1
    ? `, ${doneCount} of ${card.assignees.length} done`
    : ''}"
>
  <span class="body">
    {#if showBoard && b.board}
      <span class="board">{b.board.name}</span>
    {/if}
    <span class="top">
      <span class="t">{#each title as p, i (i)}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span>
      {#if found}
        <span class="desc found"
          >{#if found.label}<span class="where">{found.label}</span>{/if}{#each found.pieces as p, i (i)}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span
        >
      {:else if preview}<span class="desc"
          >{#each highlight(preview, words) as p, i (i)}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span
        >{/if}
    </span>
    {#if status || extra.length || dates || comments || files || card.assignees.length}
      <span class="foot">
        <span class="meta">
          {#if status}<span class="st"><StatusChip option={status} /></span>{/if}
          {#each extra as x (x.f.id)}
            {#if x.opt}
              <span class="st" title={x.text}><StatusChip option={x.opt} /></span>
            {:else}
              <span class="fv" title={x.text}
                >{#if x.f.type === 'person'}<Avatar person={x.person} size={16} />{:else if x.tick}<Icon name="check" size={12} plain />{/if}<span
                  class="fvt">{x.text}</span
                ></span
              >
            {/if}
          {/each}
          {#if due}
            <span class:late={due.late} class:soon={due.soon} title={dates}><Icon name="cal" size={16} />{due.label}</span>
          {:else if dates}
            <span title={dates}><Icon name="cal" size={16} />{dates}</span>
          {/if}
          {#if comments}<span><Icon name="chat" size={16} />{comments}</span>{/if}
          {#if files}<span><Icon name="clip" size={16} />{files}</span>{/if}
        </span>
        {#if card.assignees.length}
          <span class="avs">
            {#each card.assignees.slice(0, 4) as u (u)}
              {@const m = b.member.get(u)}
              <span
                class="av"
                title={card.done[u] != null ? (card.assignees.length > 1 ? `${m?.name ?? 'Someone'}'s part is done` : `${m?.name ?? 'Someone'} is done`) : m?.name}
                ><Avatar person={m} size={26} />{#if card.done[u] != null}<span class="tick"><Icon name="check" size={9} plain /></span>{/if}</span
              >
            {/each}
            {#if card.assignees.length > 4}<span class="more">+{card.assignees.length - 4}</span>{/if}
          </span>
        {/if}
      </span>
    {/if}
  </span>
</button>


<style>
  .card {
    display: grid;
    /* A full column scrolls; its cards never shrink to fit (overflow: hidden would let them). */
    flex: none;
    width: 100%;
    padding: 0;
    text-align: left;
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    box-shadow: 0 2px 0 var(--line);
    overflow: hidden;
    cursor: pointer;
    font: inherit;
    color: var(--text);
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
  }
  @media (hover: hover) {
    .card:hover {
      border-color: var(--line);
    }
  }
  .card.lifted {
    opacity: 0.35;
  }
  .body {
    display: grid;
    gap: 9px;
    padding: 10px 12px 12px;
  }
  .board {
    font-size: 12px;
    color: var(--muted);
    font-weight: 500;
  }
  .t {
    font-weight: 600;
    font-size: 15.5px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  /* A searched word (R3.6a). */
  mark {
    padding: 0 1px;
    margin: 0 -1px;
    border-radius: 2px;
    background: color-mix(in oklab, var(--accent) 30%, transparent);
    color: inherit;
  }
  .found .where {
    color: var(--text);
    font-weight: 500;
  }
  .completed .t {
    color: var(--muted);
  }
  /* The title, with its description's first words close under it. */
  .top {
    display: grid;
    gap: 3px;
  }
  .desc {
    font-size: 13px;
    line-height: 1.4;
    color: var(--muted);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  /* When the status, dates and counts wrap, their lines sit 8px apart. */
  .meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    color: var(--muted);
    font-size: 13px;
    min-width: 0;
  }
  .meta > span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .late {
    color: var(--redT);
    font-weight: 500;
  }
  .soon {
    color: var(--text);
    font-weight: 500;
  }
  /* A done part: a green tick on the person's avatar, as in the card window. */
  .av {
    position: relative;
    display: inline-flex;
  }
  .tick {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 13px;
    height: 13px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--s-lime);
    color: #fff;
    box-shadow: 0 0 0 2px var(--raised);
  }
  /* The chip sits on the row's line, so the icons beside it stay level with it. */
  .st {
    display: inline-flex;
    margin-left: -1px;
    min-width: 0;
    max-width: 100%;
  }
  /* A field shown on the card that isn't a dropdown: a grey chip the size of the status one. */
  .meta > .fv {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    /* The status chip's height (12.5px text, 5px above and below), a face in it or not. */
    height: 22.5px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    background: var(--tint-slate);
    color: var(--t-slate);
    font: 500 12.5px/1 var(--font);
  }
  .fv:has(:global(.av)) {
    padding-left: 3px;
  }
  .fv :global(.av) {
    border-radius: 4px;
  }
  .fvt {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .avs {
    display: flex;
    gap: 4px;
    flex: none;
    align-items: center;
  }
  .more {
    font-size: 11.5px;
    color: var(--muted);
    margin-left: 2px;
  }
</style>
