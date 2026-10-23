<script lang="ts">
  import type { CardRec, FieldRec } from '../../shared/model';
  import { allPartsDone } from '../../shared/rules';
  import { dayBefore, deadline, duration, fromLocalInput, longDate, toLocalInput, when } from '../lib/dates';
  import { hueColor, statusColors } from '../lib/hue';
  import { app } from '../lib/store.svelte';
  import Attachments from './Attachments.svelte';
  import Avatar from './Avatar.svelte';
  import Balloon from './Balloon.svelte';
  import CardHistory from './CardHistory.svelte';
  import Comments from './Comments.svelte';
  import FieldInput from './FieldInput.svelte';
  import FormatBar, { formatKey } from './FormatBar.svelte';
  import Icon from './Icon.svelte';
  import Rich from './Rich.svelte';
  import Sheet from './Sheet.svelte';
  import StatusChip from './StatusChip.svelte';
  import Dependencies from './Dependencies.svelte';
  import ElasticMark from './ElasticMark.svelte';

  const ELASTIC_URL = 'https://kaiserkhan.com/planner/';

  /**
   * A card, opened. It reads as the card itself: its status band across the top, its title, and
   * its details as plain text. Tapping a value makes it editable in place; nothing is saved
   * until Save changes (the user's rule, as in Elastic). Actions that are actions (Mark done,
   * a comment, a file, Archive) happen when they're tapped.
   */
  let { board, id }: { board: string; id: string } = $props();
  type Value = string | number | boolean | null;
  type Draft = { title?: string; desc?: string; columnId?: string; assignees?: string[]; deps?: string[]; values?: Record<string, Value> };

  const b = $derived(app.data[board]);
  const card = $derived(b?.card.get(id));
  const me = $derived(app.user?.id ?? '');
  const admin = $derived(b?.role(me) === 'admin');

  // ---------- the draft ----------

  let draft = $state<Draft>({});
  /** The card as it would be with the draft saved. */
  const view = $derived.by((): CardRec | null => {
    if (!card) return null;
    const values = { ...card.values };
    for (const [k, v] of Object.entries(draft.values ?? {})) {
      if (v == null || v === '') delete values[k];
      else values[k] = v;
    }
    return { ...card, ...draft, values } as CardRec;
  });
  const same = (a: unknown, c: unknown) => JSON.stringify(a ?? null) === JSON.stringify(c ?? null);
  /** Only what the draft really changes. */
  const patch = $derived.by((): Partial<CardRec> => {
    if (!card || !view) return {};
    const p: Partial<CardRec> = {};
    if (draft.title != null && draft.title.trim() && draft.title.trim() !== card.title) p.title = draft.title.replace(/\s+/g, ' ').trim();
    if (draft.desc != null && draft.desc !== card.desc) p.desc = draft.desc;
    if (draft.columnId && draft.columnId !== card.columnId) p.columnId = draft.columnId;
    if (draft.assignees && !same([...draft.assignees].sort(), [...card.assignees].sort())) p.assignees = draft.assignees;
    if (draft.deps && !same(draft.deps, card.deps ?? [])) p.deps = draft.deps;
    if (draft.values && !same(view.values, card.values)) p.values = view.values;
    return p;
  });
  const dirty = $derived(Object.keys(patch).length > 0);
  const setDraft = <K extends keyof Draft>(k: K, v: Draft[K]) => (draft = { ...draft, [k]: v });
  const setValue = (field: string, v: Value) => (draft = { ...draft, values: { ...(draft.values ?? {}), [field]: v } });

  let saving = $state(false);
  let asking = $state(false);
  async function save() {
    if (!dirty || !card) return;
    saving = true;
    const p = { ...patch };
    // Moved to another column: it goes to the end of it.
    if (p.columnId) p.order = (b.cardsIn(p.columnId).at(-1)?.order ?? 0) + 1;
    await app.updateCard(board, id, p);
    draft = {};
    saving = false;
    editing = null;
    if (asking) leave();
    asking = false;
  }
  function discard() {
    draft = {};
    editing = null;
    if (asking) leave();
    asking = false;
  }
  /** Where to go once the changes are saved or let go: closed, or another card. */
  let next = $state<string | null>(null);
  const leave = () => (app.open = next ? { board, id: next } : null);
  /** Closing (or opening another card) with changes not yet saved asks first. */
  function close() {
    next = null;
    if (dirty) asking = true;
    else leave();
  }
  function openCard(other: string) {
    next = other;
    if (dirty) asking = true;
    else leave();
  }

  // ---------- what's shown ----------

  const statusField = $derived(b?.statusField);
  const status = $derived(statusField?.options?.find((o) => o.id === view?.values.status));
  const band = $derived(status ? statusColors(status.hue) : null);
  const startF = $derived(b?.field.get('start'));
  const endF = $derived(b?.field.get('end'));
  const custom = $derived(b?.fields.filter((f) => !f.builtin) ?? []);
  const column = $derived(view ? b?.column.get(view.columnId) : undefined);
  const assigned = $derived(!!card && card.assignees.includes(me));
  const myDone = $derived(!!card && card.done[me] != null);
  const parts = $derived(card && card.assignees.length > 1 ? card.assignees.map((u) => card.done[u] != null) : []);
  const due = $derived(view ? deadline(view.values.end) : null);
  const historyCount = $derived(b?.logsOn(id).length ?? 0);

  // Time spent ticks while someone's timer runs.
  let now = $state(Date.now());
  const time = $derived(b ? b.timeOn(id, now) : null);
  $effect(() => {
    if (!time?.running) return;
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  /** Details (everything about the card) or History (what happened to it). */
  let tab = $state<'details' | 'history'>('details');
  /** The value being edited in place: 'title', 'desc', 'start', 'end' or a field's id. */
  let editing = $state<string | null>(null);
  let armedArchive = $state(false);
  let descEl = $state<HTMLTextAreaElement | null>(null);
  let armedDelete = $state(false);

  const focusIn = (el: HTMLElement) => {
    el.focus();
    if (el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length);
    if (el instanceof HTMLInputElement && (el.type === 'date' || el.type === 'datetime-local'))
      try {
        el.showPicker?.();
      } catch {
        /* not without a tap */
      }
  };
  // The calendar opens on a tap anywhere in the box (its own icon is hidden to save room).
  const openPicker = (e: MouseEvent) => {
    try {
      (e.currentTarget as HTMLInputElement).showPicker?.();
    } catch {
      /* already open */
    }
  };
  const autosize = (el: HTMLTextAreaElement) => {
    const fit = () => ((el.style.height = 'auto'), (el.style.height = el.scrollHeight + 'px'));
    fit();
    el.addEventListener('input', fit);
    return () => el.removeEventListener('input', fit);
  };

  function dateShown(v: unknown): string | null {
    return typeof v === 'string' && v ? longDate(v) : null;
  }
  function dateIn(f: FieldRec | undefined, v: unknown): string {
    if (typeof v !== 'string') return '';
    return f?.type === 'datetime' ? toLocalInput(v) : v.slice(0, 10);
  }
  function pickDate(field: 'start' | 'end', e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const f = field === 'start' ? startF : endF;
    const v = f?.type === 'datetime' ? fromLocalInput(el.value) : el.value || null;
    setValue(field, v);
    // A due date on a card with no start: it starts the day before.
    if (field === 'end' && v && !view?.values.start) setValue('start', dayBefore(v, startF?.type === 'datetime'));
  }
  /** A custom field's value as text (dropdowns and people are drawn separately). */
  function shown(f: FieldRec, v: Value | undefined): string | null {
    if (v == null || v === '') return null;
    if (f.type === 'date' || f.type === 'datetime') return longDate(String(v));
    if (f.type === 'checkbox') return v ? 'Yes' : 'No';
    return String(v);
  }

  async function del() {
    try {
      await app.deleteCard(board, id);
      app.say('Card deleted.');
    } catch (e) {
      app.say((e as Error).message);
    }
  }
</script>

<Sheet variant="modal" label="Card" onclose={close}>
  {#if b && view && card}
    <!-- The card's own status band, as on the board. -->
    <header
      class="band"
      class:plain={!band}
      style:--tint={band?.tint ?? 'var(--sunk)'}
      style:--ink={band?.text ?? 'var(--muted)'}
      style:--bar={band?.bar ?? 'var(--line)'}
    >
      <button class="icon-btn close" aria-label="Close" onclick={close}><Icon name="close" plain /></button>
      {#if parts.length}
        <div class="band-row">
          <span class="parts" title="{parts.filter(Boolean).length} of {parts.length} done">
            {#each parts as p, i (i)}<i class:on={p}></i>{/each}
            <span>{parts.filter(Boolean).length} of {parts.length} done</span>
          </span>
        </div>
      {/if}

      {#if editing === 'title'}
        <textarea
          class="title-edit large-text"
          rows="1"
          aria-label="Title"
          maxlength="300"
          value={view.title}
          oninput={(e) => setDraft('title', e.currentTarget.value)}
          onblur={() => (editing = null)}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLTextAreaElement).blur();
            }
          }}
          {@attach focusIn}
          {@attach autosize}
        ></textarea>
      {:else}
        <button class="title" onclick={() => (editing = 'title')} title="Edit the title">{view.title || 'Untitled'}</button>
      {/if}

      <p class="where">
        <span class="mark" style:background={hueColor(b.board?.hue)}></span>
        <span>{b.board?.name}</span>
        <Icon name="right" size={12} plain />
        <Balloon label="Column" align="start">
          {#snippet trigger({ toggle, open })}
            <button class="col-btn" aria-expanded={open} onclick={toggle}>{column?.name ?? 'No column'}<Icon name="down" size={12} plain /></button>
          {/snippet}
          {#snippet children(done)}
            <div class="menu">
              {#each b.columns as c (c.id)}
                <button class="opt" aria-pressed={view.columnId === c.id} onclick={() => (setDraft('columnId', c.id), done())}
                  >{c.name}</button
                >
              {/each}
            </div>
          {/snippet}
        </Balloon>
      </p>
    </header>

    <div class="tabs" role="tablist" aria-label="Card">
      <button role="tab" id="tab-details" aria-selected={tab === 'details'} aria-controls="pane-details" onclick={() => (tab = 'details')}
        ><Icon name="field" size={16} /> Details</button
      >
      <button role="tab" id="tab-history" aria-selected={tab === 'history'} aria-controls="pane-history" onclick={() => (tab = 'history')}
        ><Icon name="clock" size={16} /> History <span class="n">{historyCount}</span></button
      >
    </div>

    {#if tab === 'history'}
      <div class="scroll" id="pane-history" role="tabpanel" aria-labelledby="tab-history">
        <CardHistory {b} logs={b.logsOn(id)} />
      </div>
    {:else}
      <div class="scroll" id="pane-details" role="tabpanel" aria-labelledby="tab-details">
        {#if card.archived}
          <div class="archived">
            <Icon name="archive" />
            <span>Archived: hidden from the board, My cards and Elastic.</span>
            <div class="acts">
              <button class="btn" onclick={() => app.archiveCard(board, id, false)}>Restore</button>
              {#if app.canDelete(board, id)}
                {#if armedDelete}
                  <button class="btn danger" disabled={!app.online} onclick={del}>Delete for good</button>
                  <button class="btn ghost" onclick={() => (armedDelete = false)}>Keep</button>
                {:else}
                  <button class="btn ghost" onclick={() => (armedDelete = true)}><Icon name="trash" /> Delete</button>
                {/if}
              {/if}
            </div>
            {#if armedDelete}<p class="warn">Its comments and files go too, for everyone. Its history stays in Activity.</p>{/if}
          </div>
        {/if}

        <div class="layout">
          <aside class="props" aria-label="About this card">
            <div class="prop">
              <span class="pl"><Icon name="cal" size={16} /> Starts</span>
              {#if editing === 'start'}
                <span class="pv edit when">
                  <input
                    class="field date"
                    type={startF?.type === 'datetime' ? 'datetime-local' : 'date'}
                    aria-label={startF?.name ?? 'Start date'}
                    value={dateIn(startF, view.values.start)}
                    onchange={(e) => pickDate('start', e)}
                    onclick={openPicker}
                    onblur={() => (editing = null)}
                    {@attach focusIn}
                  />
                  {#if view.values.start}<button class="icon-btn sm" aria-label="Clear the start date" onmousedown={() => setValue('start', null)}
                      ><Icon name="close" size={13} /></button
                    >{/if}
                </span>
              {:else}
                <button class="pv val" class:empty={!view.values.start} onclick={() => (editing = 'start')}
                  >{dateShown(view.values.start) ?? 'Add a date'}</button
                >
              {/if}
            </div>

            <div class="prop">
              <span class="pl"><Icon name="cal" size={16} /> Due</span>
              {#if editing === 'end'}
                <span class="pv edit when">
                  <input
                    class="field date"
                    type={endF?.type === 'datetime' ? 'datetime-local' : 'date'}
                    aria-label={endF?.name ?? 'End date'}
                    value={dateIn(endF, view.values.end)}
                    onchange={(e) => pickDate('end', e)}
                    onclick={openPicker}
                    onblur={() => (editing = null)}
                    {@attach focusIn}
                  />
                  {#if view.values.end}<button class="icon-btn sm" aria-label="Clear the due date" onmousedown={() => setValue('end', null)}
                      ><Icon name="close" size={13} /></button
                    >{/if}
                </span>
              {:else}
                <button class="pv val" class:empty={!view.values.end} onclick={() => (editing = 'end')}>
                  {dateShown(view.values.end) ?? 'Add a date'}
                  {#if due && (due.late || due.soon) && status?.role !== 'completed'}<span class="due" class:late={due.late} class:soon={due.soon}
                      >{due.label}</span
                    >{/if}
                </button>
              {/if}
            </div>

            <!-- One person to a row, each with a way off the card; the add key below, in line. -->
            <div class="prop people-row" class:top={view.assignees.length > 0}>
              <span class="pl"><Icon name="people" size={16} /> People</span>
              <span class="pv people">
                {#each view.assignees as u (u)}
                  {@const m = b.member.get(u)}
                  {@const name = m?.name ?? 'Someone who left'}
                  {@const done = card.done[u] != null}
                  {#snippet who()}
                    <span class="av"
                      ><Avatar person={m} size={22} />{#if done}<span class="tick" aria-hidden="true"><Icon name="check" size={9} plain /></span>{/if}</span
                    >
                    <span class="pn">{name}</span>
                  {/snippet}
                  <span class="person" class:done>
                    {#if done && admin && u !== me}
                      <!-- An admin can take someone's done mark off: their name opens a balloon. -->
                      <Balloon label="{name}'s part" align="end">
                        {#snippet trigger({ toggle, open })}
                          <button class="who" aria-expanded={open} aria-label="{name}'s part is done" title="Their part is done" onclick={toggle}
                            >{@render who()}</button
                          >
                        {/snippet}
                        {#snippet children(close)}
                          <div class="about">
                            <p>{name} marked their part done.<br /><span class="muted">{when(card.done[u]!)}</span></p>
                            <button class="key undo-key" onclick={() => (app.undoPart(board, id, u), close())}
                              ><Icon name="undo" plain /> Mark their part not done</button
                            >
                          </div>
                        {/snippet}
                      </Balloon>
                    {:else}
                      <span class="who" title={done ? 'Their part is done' : undefined}>{@render who()}</span>
                    {/if}
                    <button
                      class="unassign"
                      aria-label="Take {name} off this card"
                      title="Take off this card"
                      onclick={() => setDraft('assignees', view.assignees.filter((x) => x !== u))}><Icon name="close" size={13} /></button
                    >
                  </span>
                {/each}
                <Balloon label="People" align="end">
                  {#snippet trigger({ toggle, open })}
                    <button class="add-person" aria-expanded={open} aria-label="Choose people" onclick={toggle}
                      >{#if view.assignees.length}<Icon name="plus" size={14} />{:else}Add people{/if}</button
                    >
                  {/snippet}
                  {#snippet children()}
                    <div class="menu">
                      {#each b.members as m (m.userId)}
                        {@const on = view.assignees.includes(m.userId)}
                        <button
                          class="opt person-opt"
                          aria-pressed={on}
                          onclick={() =>
                            setDraft('assignees', on ? view.assignees.filter((u) => u !== m.userId) : [...view.assignees, m.userId])}
                        >
                          <Avatar person={m} size={22} />
                          <span>{m.userId === me ? `${m.name} (me)` : m.name}</span>
                          {#if on}<Icon name="check" size={14} />{/if}
                        </button>
                      {/each}
                    </div>
                  {/snippet}
                </Balloon>
              </span>
            </div>

            <!-- The total, whether a timer runs and Elastic's mark on one line; who put in how much
                 below it, once more than one person has. -->
            <div class="prop" class:top={time && time.by.size > 1}>
              <span class="pl"><Icon name="clock" size={16} /> Time</span>
              <span class="pv info">
                <span class="line">
                {#if time && time.total > 0}
                  <b>{duration(time.total)}</b>{#if time.running}<span class="live">running</span>{/if}
                {/if}
                <Balloon label="About Elastic" align="end">
                  {#snippet trigger({ toggle, open })}
                    <button class="elastic-btn" class:solo={!(time && time.total > 0)} aria-expanded={open} aria-label="About Elastic" onclick={toggle}>
                      <ElasticMark size={18} />{#if !(time && time.total > 0)}<span>Tracked in Elastic</span>{/if}
                    </button>
                  {/snippet}
                  {#snippet children()}
                    <div class="about">
                      <p class="about-head"><ElasticMark size={22} /> <b>Elastic</b></p>
                      <p>Elastic is a day planner that works with Boardo. Connect it once and the cards assigned to you show on the days they're due.</p>
                      <p>Start a card there to run its timer. The time adds up here, and finishing it in Elastic marks your part done.</p>
                      <p class="muted">To connect, open Elastic and go to Settings, then Projects.</p>
                      <a class="key ink about-link" href={ELASTIC_URL} target="_blank" rel="noopener">Open Elastic</a>
                    </div>
                  {/snippet}
                </Balloon>
                </span>
                {#if time && time.by.size > 1}
                  <span class="by">
                    {#each [...time.by] as [u, ms] (u)}<span><Avatar person={b.member.get(u)} size={16} /> {duration(ms)}</span>{/each}
                  </span>
                {/if}
              </span>
            </div>

            <div class="prop">
              <span class="pl"><Icon name="status" size={16} /> Status</span>
              <span class="pv">
                <Balloon label="Status" align="start">
                  {#snippet trigger({ toggle, open })}
                    <button class="val status-btn" class:empty={!status} aria-expanded={open} onclick={toggle}>
                      {#if status}<StatusChip option={status} />{:else}Set a status{/if}<Icon name="down" size={14} plain />
                    </button>
                  {/snippet}
                  {#snippet children(done)}
                    <div class="menu">
                      {#each statusField?.options ?? [] as o (o.id)}
                        <button
                          class="opt"
                          aria-pressed={view.values.status === o.id}
                          onclick={() => (setValue('status', o.id), done())}><StatusChip option={o} /></button
                        >
                      {/each}
                      <button class="opt quiet" aria-pressed={!view.values.status} onclick={() => (setValue('status', null), done())}
                        >No status</button
                      >
                    </div>
                  {/snippet}
                </Balloon>
              </span>
            </div>

            {#each custom as f (f.id)}
              {@const v = view.values[f.id]}
              <div class="prop">
                <span class="pl"><Icon name="field" size={16} /> {f.name}</span>
                {#if f.type === 'checkbox'}
                  <span class="pv">
                    <button
                      class="switch"
                      class:on={v === true}
                      role="switch"
                      aria-checked={v === true}
                      aria-label={f.name}
                      onclick={() => setValue(f.id, v === true ? null : true)}><span></span></button
                    >
                  </span>
                {:else if editing === f.id}
                  <span class="pv edit" {@attach (el: HTMLElement) => el.querySelector<HTMLElement>('input, textarea, select')?.focus()}>
                    <FieldInput
                      field={f}
                      id="f-{f.id}"
                      value={v}
                      members={b.members}
                      onsave={(nv) => {
                        setValue(f.id, nv);
                        if (f.type !== 'text' && f.type !== 'longtext' && f.type !== 'number') editing = null;
                      }}
                    />
                    <button class="btn ghost sm" onclick={() => (editing = null)}>Done</button>
                  </span>
                {:else}
                  <button class="pv val" class:empty={v == null || v === ''} onclick={() => (editing = f.id)}>
                    {#if f.type === 'dropdown' && v}
                      <StatusChip option={f.options?.find((o) => o.id === v)} />
                    {:else if f.type === 'person' && v}
                      <Avatar person={b.member.get(String(v))} size={20} /> {b.member.get(String(v))?.name ?? 'Someone who left'}
                    {:else}
                      {shown(f, v) ?? 'Add'}
                    {/if}
                  </button>
                {/if}
              </div>
            {/each}

            {#if assigned}
              <div class="part">
                {#if myDone}
                  <span class="ok"><Icon name="check" /> Your part is done</span>
                  <button class="key undo-key" onclick={() => app.markPart(board, id, false)}><Icon name="undo" plain /> Mark not done</button>
                {:else}
                  <button class="key go done-key" onclick={() => app.markPart(board, id, true)}><Icon name="check" plain /> Mark done</button>
                  {#if card.assignees.length > 1 && !allPartsDone(card)}
                    <span class="note">Completes when everyone's part is done.</span>
                  {/if}
                {/if}
              </div>
            {/if}

            {#if !card.archived}
              <div class="archive">
                {#if armedArchive}
                  <span>Archive this card?</span>
                  <button class="btn danger sm" onclick={() => app.archiveCard(board, id, true)}>Archive</button>
                  <button class="btn ghost sm" onclick={() => (armedArchive = false)}>Keep</button>
                {:else}
                  <button class="link" onclick={() => (armedArchive = true)}><Icon name="archive" size={16} /> Archive card</button>
                {/if}
              </div>
            {/if}
          </aside>

          <div class="main">
            <section class="sect">
              <h2><Icon name="log" size={16} /> Description</h2>
              {#if editing === 'desc'}
                <!-- Open until focus leaves the box and its formatting keys together. -->
                <div
                  class="editor"
                  onfocusout={(e) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null) && (editing = null)}
                >
                  <FormatBar el={descEl} />
                  <textarea
                    class="field desc-edit"
                    rows="4"
                    maxlength="20000"
                    aria-label="Description"
                    placeholder="What's this card about?"
                    value={view.desc}
                    bind:this={descEl}
                    oninput={(e) => setDraft('desc', e.currentTarget.value)}
                    onkeydown={(e) => descEl && formatKey(descEl, e)}
                    {@attach focusIn}
                    {@attach autosize}
                  ></textarea>
                </div>
              {:else if view.desc.trim()}
                <!-- A block, not a button: lists and paragraphs can't go in a button. -->
                <div
                  class="desc"
                  role="button"
                  tabindex="0"
                  aria-label="Edit the description"
                  onclick={(e) => !(e.target as Element).closest('a') && (editing = 'desc')}
                  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), (editing = 'desc'))}
                >
                  <Rich text={view.desc} />
                </div>
              {:else}
                <button class="desc empty" onclick={() => (editing = 'desc')}>Add a description</button>
              {/if}
            </section>

            <Attachments {b} cardId={id} />

            <section class="sect">
              <Dependencies {b} cardId={id} deps={view.deps ?? []} onchange={(d) => setDraft('deps', d)} onopen={openCard} />
            </section>

            <section class="sect"><Comments {b} cardId={id} /></section>
          </div>
        </div>
      </div>
    {/if}

    {#if dirty || asking}
      <div class="savebar" role="region" aria-label="Unsaved changes">
        <span class="sb-note"
          ><span class="sb-dot" aria-hidden="true"></span>{asking ? (next ? 'Save your changes before opening that card?' : 'Save your changes before closing?') : 'Unsaved changes'}</span
        >
        {#if asking}<button class="btn ghost" onclick={() => (asking = false)}>Keep editing</button>{/if}
        <button class="btn ghost" onclick={discard}>Discard</button>
        <button class="key ink" disabled={saving} onclick={save}>Save changes</button>
      </div>
    {/if}
  {:else}
    <div class="gone">
      <span>This card isn't here any more.</span>
      <button class="icon-btn" aria-label="Close" onclick={() => (app.open = null)}><Icon name="close" /></button>
    </div>
  {/if}
</Sheet>

<style>
  /* ---------- the band: the card's status, its title, where it lives ---------- */
  .band {
    flex: none;
    background: var(--tint);
    padding: 16px 60px 14px 20px;
    border-bottom: 1px solid color-mix(in oklab, var(--bar) 30%, transparent);
    position: relative;
  }
  .band-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 28px;
    margin-bottom: 4px;
  }
  .status-btn :global(.status) {
    font-size: 13px;
  }
  .elastic-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 36px;
    padding: 0 8px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--muted);
    font: 400 13.5px var(--font);
    cursor: pointer;
  }
  .elastic-btn.solo {
    margin-left: -8px;
  }
  .elastic-btn span {
    text-decoration: underline dotted color-mix(in oklab, var(--muted) 60%, transparent);
    text-underline-offset: 3px;
  }
  @media (hover: hover) {
    .elastic-btn:hover {
      background: var(--sunk);
      color: var(--text);
    }
  }
  .about {
    display: grid;
    gap: 8px;
    padding: 8px 8px 6px;
    /* A set width: a balloon of text would otherwise shrink to its narrowest. */
    width: min(264px, 74vw);
    font-size: 13.5px;
    line-height: 1.45;
  }
  .about p {
    margin: 0;
  }
  .about .muted {
    color: var(--muted);
    font-size: 12.5px;
  }
  .about-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
  }
  .about-link {
    margin-top: 4px;
    min-height: 40px;
    text-decoration: none;
  }
  .parts {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--ink);
    font: 500 12px var(--font);
  }
  .parts i {
    width: 14px;
    height: 6px;
    border-radius: 1px;
    background: color-mix(in oklab, var(--ink) 22%, transparent);
  }
  .parts i.on {
    background: var(--s-lime);
  }
  .parts span {
    margin-left: 5px;
  }
  .close {
    position: absolute;
    top: 8px;
    right: 10px;
    color: var(--ink);
  }
  .title,
  .title-edit {
    display: block;
    width: calc(100% + 8px);
    margin: 2px 0 0 -4px;
    padding: 2px 4px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text);
    font: 600 22px/1.25 var(--font);
    text-align: left;
    cursor: text;
    overflow-wrap: anywhere;
    resize: none;
  }
  .title-edit {
    background: var(--raised);
    outline: 2px solid var(--accent);
    overflow: hidden;
  }
  @media (hover: hover) {
    .title:hover {
      background: color-mix(in oklab, var(--raised) 55%, transparent);
    }
  }
  .where {
    margin: 6px 0 0;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    color: var(--muted);
    font-size: 12.5px;
  }
  .where :global(svg) {
    color: var(--faint);
  }
  .mark {
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }
  .col-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
    padding: 0 6px;
    margin-left: -4px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text);
    font: 500 12.5px var(--font);
    cursor: pointer;
  }
  @media (hover: hover) {
    .col-btn:hover {
      background: color-mix(in oklab, var(--text) 7%, transparent);
    }
  }

  /* ---------- balloons' menus ---------- */
  .menu {
    display: grid;
    gap: 2px;
    max-height: 300px;
    overflow-y: auto;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 8px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text);
    font: 500 13.5px var(--font);
    text-align: left;
    cursor: pointer;
  }
  .opt[aria-pressed='true'] {
    background: var(--sunk);
  }
  @media (hover: hover) {
    .opt:hover {
      background: var(--sunk);
    }
  }
  .opt.quiet {
    color: var(--muted);
  }
  .person-opt span {
    flex: 1;
  }

  /* ---------- tabs ---------- */
  .tabs {
    display: flex;
    gap: 14px;
    padding: 6px 20px 0;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .tabs button {
    border: none;
    background: none;
    color: var(--muted);
    font: 500 13.5px var(--font);
    min-height: 40px;
    padding: 0 14px;
    margin: 6px 0 -1px;
    border-bottom: 2px solid transparent;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  /* The icon makes the left look fuller, so Details gets more room on its right. */
  #tab-details {
    padding: 0 28px 0 14px;
  }
  .tabs button[aria-selected='true'] {
    color: var(--text);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
  .tabs .n {
    font: 600 11px/1 var(--font);
    color: var(--muted);
    background: var(--sunk);
    border-radius: var(--r-sm);
    padding: 3px 6px;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 18px 20px max(28px, env(safe-area-inset-bottom));
  }

  /* ---------- two columns on a computer: the card's story, and its facts ---------- */
  .layout {
    display: grid;
    gap: 22px;
  }
  @media (min-width: 768px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 260px;
      align-items: start;
    }
    .props {
      order: 2;
      position: sticky;
      top: 0;
    }
  }
  .props {
    display: grid;
    gap: 2px;
    align-content: start;
  }
  .prop {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    align-items: center;
    gap: 6px;
    min-height: 40px;
  }
  .pl {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--muted);
    font-size: 12.5px;
  }
  .pv {
    min-width: 0;
    font-size: 14px;
  }
  .val {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 36px;
    padding: 4px 8px;
    margin-left: -8px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text);
    font: 500 14px var(--font);
    text-align: left;
    cursor: pointer;
  }
  @media (hover: hover) {
    .val:hover {
      background: var(--sunk);
    }
  }
  .val.empty,
  .desc.empty {
    color: var(--faint);
    font-weight: 400;
  }
  .edit {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  /* A date and its clear button stay on one line in the narrow side column. */
  .edit.when {
    flex-wrap: nowrap;
  }
  .date {
    width: auto;
    min-width: 0;
    flex: 1 1 0;
    min-height: 36px;
    padding: 4px 8px;
    font-size: 14px;
    cursor: pointer;
  }
  .date::-webkit-calendar-picker-indicator {
    display: none;
  }
  .icon-btn.sm {
    width: 32px;
    height: 32px;
  }
  .btn.sm {
    min-height: 32px;
    padding: 0 10px;
    font-size: 13px;
  }
  .due {
    font: 600 11.5px/1 var(--font);
    padding: 4px 6px;
    border-radius: var(--r-sm);
    background: var(--tint-indigo);
    color: var(--t-indigo);
  }
  .due.soon {
    background: var(--tint-yellow);
    color: var(--t-yellow);
  }
  .due.late {
    background: var(--tint-rose);
    color: var(--t-rose);
  }
  .people {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    justify-items: start;
    align-items: center;
  }
  .person {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    min-height: 40px;
    font-size: 13.5px;
    font-weight: 500;
  }
  .person .pn {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .person > :global(.anchor) {
    min-width: 0;
  }
  button.who {
    min-height: 32px;
    padding: 0 6px;
    margin-left: -6px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  @media (hover: hover) {
    button.who:hover {
      background: var(--sunk);
    }
  }
  /* A done part: a green tick on the person's avatar. */
  .av {
    position: relative;
    display: inline-flex;
    flex: none;
  }
  .tick {
    position: absolute;
    right: -4px;
    bottom: -3px;
    width: 13px;
    height: 13px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--s-lime);
    color: #fff;
    box-shadow: 0 0 0 2px var(--bg);
  }
  .unassign {
    flex: none;
    width: 30px;
    height: 30px;
    margin-left: auto;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--faint);
    cursor: pointer;
  }
  /* With a mouse, the remove key shows when pointing at the person, over the end of the row,
     so names keep the narrow column's whole width. On touch it's always there. */
  @media (hover: hover) {
    .person {
      position: relative;
    }
    .unassign {
      position: absolute;
      right: 0;
      opacity: 0;
      background: var(--bg);
      box-shadow: -10px 0 8px -2px var(--bg);
    }
    .person:hover .unassign,
    .unassign:focus-visible {
      opacity: 1;
    }
    .unassign:hover {
      background: var(--sunk);
      color: var(--redT);
    }
  }
  @media (pointer: coarse) {
    .person,
    button.who,
    .prop.people-row.top .pl {
      min-height: 44px;
    }
    .unassign {
      width: 44px;
      height: 44px;
      margin-right: -7px;
    }
  }
  .people > :global(:last-child) {
    margin: 4px 0;
  }

  .add-person {
    min-height: 32px;
    min-width: 32px;
    padding: 0 8px;
    border: 1px dashed var(--line);
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--muted);
    font: 500 13px var(--font);
    display: inline-grid;
    place-items: center;
    cursor: pointer;
  }
  .info {
    display: grid;
    gap: 2px;
  }
  .info .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 40px;
  }
  /* With a second line, the label sits level with the first. */
  .prop.top {
    align-items: start;
  }
  .prop.top .pl {
    min-height: 40px;
  }
  .info b {
    font-weight: 600;
  }
  .info .by {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    padding-bottom: 8px;
    color: var(--muted);
    font-size: 12.5px;
  }
  .info .by span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .live {
    font: 600 11px var(--font);
    color: var(--t-indigo);
    background: var(--tint-indigo);
    padding: 3px 6px;
    border-radius: var(--r-sm);
  }
  .part {
    display: grid;
    justify-items: start;
    gap: 6px;
    margin: 12px 0 4px;
  }
  .done-key {
    justify-self: stretch;
    padding: 0 26px;
    min-height: 44px;
  }
  /* Smaller than Mark done, in a soft rose: taking your part back. */
  .undo-key {
    justify-self: stretch;
    min-height: 38px;
    font-size: 13.5px;
    color: var(--t-rose);
    background: color-mix(in oklab, var(--s-rose) 9%, var(--raised));
    border-color: color-mix(in oklab, var(--s-rose) 28%, transparent);
    box-shadow: 0 3px 0 color-mix(in oklab, var(--s-rose) 30%, var(--edge));
  }
  .undo-key:active {
    box-shadow: 0 0 0 transparent;
  }
  .ok {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--grT);
    font-weight: 600;
    font-size: 14px;
  }
  .note {
    color: var(--muted);
    font-size: 12.5px;
  }
  .archive {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 13px;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    border: none;
    background: none;
    padding: 0;
    color: var(--muted);
    font: 500 13px var(--font);
    cursor: pointer;
  }

  /* ---------- the story: description, files, comments ---------- */
  .main {
    display: grid;
    gap: 22px;
    min-width: 0;
    align-content: start;
  }
  .sect {
    display: grid;
    gap: 8px;
  }
  h2 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    font: 600 13.5px var(--font);
  }
  .desc {
    display: block;
    width: calc(100% + 10px);
    min-height: 44px;
    padding: 8px 10px;
    margin-left: -10px;
    border: none;
    border-radius: var(--r-ctl);
    background: transparent;
    color: var(--text);
    font: 400 14px/1.55 var(--font);
    text-align: left;
    overflow-wrap: anywhere;
    cursor: text;
  }
  .desc:focus-visible {
    outline: 2px solid var(--accent);
  }
  .desc.empty {
    width: 100%;
    background: var(--sunk);
    margin-left: 0;
  }
  @media (hover: hover) {
    .desc:hover {
      background: var(--sunk);
    }
  }
  /* One box: the formatting keys along its top, the text below. */
  .editor {
    border: 1px solid var(--line);
    border-radius: var(--r-ctl);
    background: var(--raised);
  }
  .editor:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: transparent;
  }
  .editor :global(.bar) {
    border-bottom: 1px solid var(--border);
  }
  .desc-edit {
    min-height: 110px;
    font-size: 14px;
    line-height: 1.55;
    resize: none;
    border: none;
    background: transparent;
  }
  .desc-edit:focus {
    outline: none;
  }

  .archived {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    padding: 10px 12px;
    margin-bottom: 16px;
    background: var(--tint-yellow);
    color: var(--t-yellow);
    border-radius: var(--r-ctl);
    font-size: 13.5px;
  }
  .archived .acts {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-left: auto;
  }
  .warn {
    width: 100%;
    margin: 0;
    font-size: 12.5px;
    color: var(--redT);
  }

  /* ---------- unsaved changes ---------- */
  .savebar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 10px 16px max(10px, env(safe-area-inset-bottom)) 20px;
    background: var(--raised);
    border-top: 1px solid var(--border);
    box-shadow: 0 -8px 20px -14px rgba(0, 0, 0, 0.3);
    animation: rise 160ms ease-out;
  }
  .sb-note {
    flex: 1 1 auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 500 13.5px var(--font);
  }
  .sb-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--s-yellow);
  }
  @keyframes rise {
    from {
      translate: 0 8px;
      opacity: 0;
    }
  }
  .gone {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 12px 20px;
    color: var(--muted);
  }
  @media (max-width: 400px) {
    .prop {
      grid-template-columns: 80px minmax(0, 1fr);
    }
  }
</style>
