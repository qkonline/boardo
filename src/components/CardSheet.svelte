<script lang="ts">
  import { allPartsDone } from '../../shared/rules';
  import { duration, fromLocalInput, toLocalInput } from '../lib/dates';
  import { hueColor } from '../lib/hue';
  import { app } from '../lib/store.svelte';
  import Attachments from './Attachments.svelte';
  import Avatar from './Avatar.svelte';
  import Comments from './Comments.svelte';
  import FieldInput from './FieldInput.svelte';
  import Icon from './Icon.svelte';
  import LogList from './LogList.svelte';
  import Sheet from './Sheet.svelte';
  import StatusChip from './StatusChip.svelte';

  /** A card, opened: every field, Time spent, parts, files, comments and its log. */
  let { board, id }: { board: string; id: string } = $props();
  const b = $derived(app.data[board]);
  const card = $derived(b?.card.get(id));
  const me = $derived(app.user?.id ?? '');
  const statusField = $derived(b?.statusField);
  const status = $derived(statusField?.options?.find((o) => o.id === card?.values.status));
  const start = $derived(b?.field.get('start'));
  const end = $derived(b?.field.get('end'));
  const custom = $derived(b?.fields.filter((f) => !f.builtin) ?? []);
  const assigned = $derived(!!card && card.assignees.includes(me));
  const myDone = $derived(!!card && card.done[me] != null);
  const doneCount = $derived(card ? card.assignees.filter((u) => card.done[u] != null).length : 0);

  // Time spent ticks while someone's timer runs.
  let now = $state(Date.now());
  const time = $derived(b ? b.timeOn(id, now) : null);
  $effect(() => {
    if (!time?.running) return;
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  let title = $state('');
  let desc = $state('');
  let picking = $state(false);
  let armedArchive = $state(false);
  // Keep the text boxes in step with the card, except while someone is typing in them.
  let editingTitle = false;
  let editingDesc = false;
  $effect(() => {
    if (card && !editingTitle) title = card.title;
    if (card && !editingDesc) desc = card.desc;
  });

  const close = () => (app.open = null);

  function saveTitle() {
    editingTitle = false;
    const t = title.replace(/\s+/g, ' ').trim();
    if (!card) return;
    if (!t) title = card.title;
    else if (t !== card.title) void app.updateCard(board, id, { title: t });
  }
  function saveDesc() {
    editingDesc = false;
    if (card && desc !== card.desc) void app.updateCard(board, id, { desc });
  }

  function dateInput(field: 'start' | 'end', e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const f = field === 'start' ? start : end;
    const v = f?.type === 'datetime' ? fromLocalInput(el.value) : el.value || null;
    void app.setValue(board, id, field, v);
  }
  const dateValue = (field: 'start' | 'end') => {
    const v = card?.values[field];
    const f = field === 'start' ? start : end;
    if (typeof v !== 'string') return '';
    return f?.type === 'datetime' ? toLocalInput(v) : v.slice(0, 10);
  };
</script>

<Sheet variant="full" label="Card" onclose={close}>
  {#if b && card}
    <div class="top">
      <span class="crumb">
        <span class="mark" style:background={hueColor(b.board?.hue)}></span>
        {b.board?.name}
        {#if b.column.get(card.columnId)}
          <span class="sep">·</span>
          <select
            class="col"
            aria-label="Column"
            value={card.columnId}
            onchange={(e) => app.moveCard(board, id, e.currentTarget.value, b.cardsIn(e.currentTarget.value).at(-1)?.id ?? null, null)}
          >
            {#each b.columns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
        {/if}
      </span>
      <button class="icon-btn" aria-label="Close" onclick={close}><Icon name="close" /></button>
    </div>

    <div class="scroll">
      {#if card.archived}
        <div class="archived">
          <span>This card is archived. It's hidden from the board, My cards and Elastic.</span>
          <button class="key" onclick={() => app.archiveCard(board, id, false)}>Restore</button>
        </div>
      {/if}

      <textarea
        class="title large-text"
        rows="1"
        aria-label="Title"
        maxlength="300"
        bind:value={title}
        onfocus={() => (editingTitle = true)}
        onblur={saveTitle}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLTextAreaElement).blur();
          }
        }}
        {@attach (el: HTMLTextAreaElement) => {
          const fit = () => ((el.style.height = 'auto'), (el.style.height = el.scrollHeight + 'px'));
          fit();
          el.addEventListener('input', fit);
          return () => el.removeEventListener('input', fit);
        }}
      ></textarea>

      <dl class="fields">
        <dt><label for="f-status">Status</label></dt>
        <dd class="status-dd">
          <StatusChip option={status} />
          <select
            id="f-status"
            class="over"
            value={card.values.status ?? ''}
            onchange={(e) => app.setValue(board, id, 'status', e.currentTarget.value || null)}
          >
            {#if !status}<option value="">Not set</option>{/if}
            {#each statusField?.options ?? [] as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
          </select>
          {#if card.assignees.length > 1}<span class="parts-n">{doneCount} of {card.assignees.length} done</span>{/if}
        </dd>

        <dt><label for="f-start">{start?.name ?? 'Start date'}</label></dt>
        <dd>
          <input
            id="f-start"
            class="field date"
            type={start?.type === 'datetime' ? 'datetime-local' : 'date'}
            value={dateValue('start')}
            onchange={(e) => dateInput('start', e)}
          />
          {#if card.values.start}<button class="icon-btn" aria-label="Clear start date" onclick={() => app.setValue(board, id, 'start', null)}
              ><Icon name="close" size={14} /></button
            >{/if}
        </dd>

        <dt><label for="f-end">{end?.name ?? 'End date'}</label></dt>
        <dd>
          <input
            id="f-end"
            class="field date"
            type={end?.type === 'datetime' ? 'datetime-local' : 'date'}
            value={dateValue('end')}
            onchange={(e) => dateInput('end', e)}
          />
          {#if card.values.end}<button class="icon-btn" aria-label="Clear end date" onclick={() => app.setValue(board, id, 'end', null)}
              ><Icon name="close" size={14} /></button
            >{/if}
        </dd>

        <dt>Assignees</dt>
        <dd class="people">
          {#each card.assignees as u (u)}
            {@const m = b.member.get(u)}
            <span class="person" class:done={card.done[u] != null}>
              <Avatar person={m} size={24} />
              <span>{m?.name ?? 'Someone who left'}</span>
              {#if card.done[u] != null}<Icon name="check" size={15} />{/if}
            </span>
          {/each}
          <button class="btn small" aria-expanded={picking} onclick={() => (picking = !picking)}>
            {#if card.assignees.length}Change{:else}<Icon name="people" /> Assign{/if}
          </button>
        </dd>
        {#if picking}
          <dd class="pick">
            {#each b.members as m (m.userId)}
              <button
                class="chip"
                aria-pressed={card.assignees.includes(m.userId)}
                onclick={() => app.toggleAssignee(board, id, m.userId)}
              >
                <Avatar person={m} size={20} />{m.userId === me ? `${m.name} (me)` : m.name}
              </button>
            {/each}
          </dd>
        {/if}

        <dt>Time spent</dt>
        <dd class="time">
          {#if time && time.total > 0}
            <b>{duration(time.total)}</b>{#if time.running}<span class="live">running</span>{/if}
            <span class="by">
              {#each [...time.by] as [u, ms] (u)}
                <span><Avatar person={b.member.get(u)} size={18} /> {duration(ms)}</span>
              {/each}
            </span>
          {:else}
            <span class="none">None yet. Time comes from timers started in Elastic.</span>
          {/if}
        </dd>

        {#each custom as f (f.id)}
          <dt><label for="f-{f.id}">{f.name}</label></dt>
          <dd>
            <FieldInput
              field={f}
              id="f-{f.id}"
              value={card.values[f.id]}
              members={b.members}
              onsave={(v) => app.setValue(board, id, f.id, v)}
            />
          </dd>
        {/each}
      </dl>

      {#if assigned}
        <div class="part">
          {#if myDone}
            <span class="ok"><Icon name="check" /> Your part is done</span>
            <button class="btn" onclick={() => app.markPart(board, id, false)}>Not done yet</button>
          {:else}
            <button class="key ink" onclick={() => app.markPart(board, id, true)}><Icon name="check" plain /> Mark my part done</button>
            {#if card.assignees.length > 1 && !allPartsDone(card)}
              <span class="note">The card completes when everyone's part is done.</span>
            {/if}
          {/if}
        </div>
      {/if}

      <div class="block">
        <label class="label" for="f-desc">Description</label>
        <textarea
          id="f-desc"
          class="field"
          rows="4"
          maxlength="20000"
          placeholder="Add more detail"
          bind:value={desc}
          onfocus={() => (editingDesc = true)}
          onblur={saveDesc}
        ></textarea>
      </div>

      <Attachments {b} cardId={id} />

      <div class="block"><Comments {b} cardId={id} /></div>

      <div class="block">
        <h3 class="label">Log</h3>
        <LogList {b} logs={b.logsOn(id)} onCard limit={8} />
      </div>

      {#if !card.archived}
        <div class="foot">
          {#if armedArchive}
            <span>Archive this card?</span>
            <button class="btn danger" onclick={() => app.archiveCard(board, id, true)}>Archive</button>
            <button class="btn ghost" onclick={() => (armedArchive = false)}>Keep</button>
          {:else}
            <button class="btn" onclick={() => (armedArchive = true)}><Icon name="archive" /> Archive card</button>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="top">
      <span class="crumb">This card isn't here any more.</span>
      <button class="icon-btn" aria-label="Close" onclick={close}><Icon name="close" /></button>
    </div>
  {/if}
</Sheet>

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 8px 0 20px;
    flex: none;
  }
  .crumb {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 13px;
    min-width: 0;
  }
  .mark {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex: none;
  }
  .sep {
    color: var(--faint);
  }
  .col {
    border: none;
    background: none;
    font: 500 13px var(--font);
    color: var(--muted);
    min-height: 36px;
    max-width: 50vw;
    cursor: pointer;
    padding: 0 4px;
  }
  .scroll {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 20px max(28px, env(safe-area-inset-bottom));
    display: grid;
    gap: 18px;
    align-content: start;
  }
  .archived {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--sunk);
    border-radius: var(--r-ctl);
    font-size: 14px;
    flex-wrap: wrap;
  }
  .title {
    width: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    font: 600 21px/1.25 var(--font);
    resize: none;
    padding: 4px 0;
    overflow: hidden;
    border-radius: var(--r-sm);
  }
  .title:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .fields {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    gap: 10px 12px;
    margin: 0;
    align-items: center;
    font-size: 14px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .status-dd {
    position: relative;
  }
  .over {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .parts-n {
    color: var(--muted);
    font-size: 13px;
    margin-left: 4px;
  }
  .date {
    width: auto;
    min-width: 0;
    flex: 1 1 160px;
    max-width: 240px;
    min-height: 40px;
    padding: 6px 10px;
  }
  .people {
    gap: 8px;
  }
  .person {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .btn.small {
    min-height: 34px;
    padding: 0 10px;
    font-size: 13px;
  }
  .pick {
    grid-column: 1 / -1;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding: 4px 0;
  }
  .time b {
    font-weight: 600;
  }
  .time .by {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    color: var(--muted);
    font-size: 13px;
    width: 100%;
  }
  .time .by span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .live {
    font-size: 12px;
    color: var(--t-indigo);
    background: var(--tint-indigo);
    padding: 2px 6px;
    border-radius: var(--r-sm);
  }
  .none {
    color: var(--faint);
    font-size: 13px;
  }
  .part {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .ok {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--grT);
    font-weight: 600;
  }
  .note {
    color: var(--muted);
    font-size: 13px;
  }
  .block {
    display: grid;
    gap: 8px;
  }
  h3 {
    margin: 0;
  }
  .foot {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  @media (max-width: 400px) {
    .fields {
      grid-template-columns: 88px minmax(0, 1fr);
    }
  }
</style>
