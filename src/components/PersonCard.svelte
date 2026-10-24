<script lang="ts">
  import type { MemberRec } from '../../shared/model';
  import type { BoardState } from '../lib/board.svelte';
  import { app } from '../lib/store.svelte';
  import Avatar from './Avatar.svelte';

  /** Who someone in the board is: their name (first and last), email, role here and open cards here. */
  let { person, b }: { person: MemberRec; b?: BoardState } = $props();

  const words = $derived(person.name.trim().split(/\s+/));
  const first = $derived(words[0] ?? '');
  const last = $derived(words.slice(1).join(' '));
  const me = $derived(person.userId === app.user?.id);
  const open = $derived.by(() => {
    if (!b) return null;
    const done = b.statusField?.options?.find((o) => o.role === 'completed')?.id;
    return [...b.card.values()].filter((c) => !c.archived && c.assignees.includes(person.userId) && c.values.status !== done).length;
  });
</script>

<div class="person">
  <div class="top">
    <Avatar {person} size={48} />
    <div class="id">
      <b>{person.name}{me ? ' (you)' : ''}</b>
      <span class="role">{person.role === 'admin' ? 'Admin' : 'Member'}{b?.board ? ` in ${b.board.name}` : ''}</span>
    </div>
  </div>
  <dl>
    <div><dt>First name</dt><dd>{first}</dd></div>
    {#if last}<div><dt>Last name</dt><dd>{last}</dd></div>{/if}
    <div class="wide"><dt>Email</dt><dd><a href="mailto:{person.email}">{person.email}</a></dd></div>
    {#if open != null}<div><dt>Open cards here</dt><dd>{open}</dd></div>{/if}
  </dl>
</div>

<style>
  .person {
    width: min(260px, 76vw);
    padding: 6px 6px 4px;
    display: grid;
    gap: 12px;
    text-align: left;
    white-space: normal;
    font: 400 14px/1.35 var(--font);
    color: var(--text);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .id {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .id b {
    font-size: 16px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .role {
    font-size: 13px;
    color: var(--muted);
  }
  dl {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 12px;
  }
  dl div {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .wide {
    grid-column: 1 / -1;
  }
  dt {
    color: var(--muted);
    font-size: 12.5px;
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  a {
    color: var(--t-indigo);
  }
</style>
