<script lang="ts">
  import { type FieldOption, type FieldRec, type FieldType, newId } from '../../shared/model';
  import type { BoardState } from '../lib/board.svelte';
  import { app } from '../lib/store.svelte';
  import HuePicker from './HuePicker.svelte';
  import Icon from './Icon.svelte';
  import StatusChip from './StatusChip.svelte';

  /**
   * The board's fields (admins, R4.2 to R4.9): built-in dates can switch between date and date
   * and time; Status values can be renamed and added (the In progress and Completed ones can't
   * be removed); custom fields can be added, renamed, retyped, reordered and removed.
   */
  let { b }: { b: BoardState } = $props();

  const TYPE_NAMES: Record<FieldType, string> = {
    text: 'Text',
    longtext: 'Long text',
    number: 'Number',
    date: 'Date',
    datetime: 'Date and time',
    dropdown: 'Dropdown',
    checkbox: 'Checkbox',
    person: 'Person',
  };

  let open = $state<string | null>(null);
  let draft = $state<FieldRec | null>(null);
  let armed = $state(false);
  let adding = $state(false);
  let newName = $state('');
  let newType = $state<FieldType>('text');

  function edit(f: FieldRec) {
    open = f.id;
    draft = structuredClone($state.snapshot(f)) as FieldRec;
    armed = false;
  }

  async function save() {
    if (!draft || !draft.name.trim()) return;
    const f = { ...draft, name: draft.name.trim() };
    if (f.type === 'dropdown') f.options = (f.options ?? []).map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label || o.role);
    else delete f.options;
    await app.saveField(b.id, f);
    open = null;
    draft = null;
  }

  async function add(e: Event) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const id = await app.addField(b.id, {
      name,
      type: newType,
      ...(newType === 'dropdown' ? { options: [{ id: newId(8), label: 'Option 1', hue: 'cyan' as const }] } : {}),
    });
    newName = '';
    adding = false;
    const f = b.field.get(id);
    if (f && newType === 'dropdown') edit(f);
  }

  function addOption() {
    if (!draft) return;
    const n = (draft.options?.length ?? 0) + 1;
    draft.options = [...(draft.options ?? []), { id: newId(8), label: `Option ${n}`, hue: 'cyan' } satisfies FieldOption];
  }
  function removeOption(i: number) {
    if (!draft?.options) return;
    draft.options = draft.options.filter((_, j) => j !== i);
  }
  function moveOption(i: number, d: -1 | 1) {
    if (!draft?.options) return;
    const o = [...draft.options];
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    draft.options = o;
  }
</script>

<ul class="fields">
  {#each b.fields as f, i (f.id)}
    <li>
      <div class="row">
        <Icon name="field" />
        <span class="name">{f.name}<small>{TYPE_NAMES[f.type]}{f.builtin ? ', built in' : ''}</small></span>
        <button class="icon-btn" aria-label="Move {f.name} up" disabled={i === 0} onclick={() => app.moveField(b.id, f.id, -1)}
          ><Icon name="up" /></button
        >
        <button
          class="icon-btn"
          aria-label="Move {f.name} down"
          disabled={i === b.fields.length - 1}
          onclick={() => app.moveField(b.id, f.id, 1)}><Icon name="down" /></button
        >
        <button class="btn small" aria-expanded={open === f.id} onclick={() => (open === f.id ? (open = null) : edit(f))}
          >{open === f.id ? 'Close' : 'Edit'}</button
        >
      </div>
      {#if open === f.id && draft}
        <div class="edit">
          <label class="label" for="fn-{f.id}">Name</label>
          <input id="fn-{f.id}" class="field" maxlength="100" bind:value={draft.name} />
          {#if f.builtin === 'start' || f.builtin === 'end'}
            <label class="check"
              ><input type="checkbox" checked={draft.type === 'datetime'} onchange={(e) => (draft!.type = e.currentTarget.checked ? 'datetime' : 'date')} /> Include a time</label
            >
          {:else if !f.builtin}
            <label class="label" for="ft-{f.id}">Type</label>
            <select id="ft-{f.id}" class="field" bind:value={draft.type}>
              {#each Object.entries(TYPE_NAMES) as [t, n] (t)}<option value={t}>{n}</option>{/each}
            </select>
          {/if}
          {#if draft.type === 'dropdown'}
            <span class="label">Values</span>
            {#each draft.options ?? [] as o, j (o.id)}
              <div class="opt">
                <div class="opt-row">
                  <StatusChip option={o} />
                  <input class="field" maxlength="60" aria-label="Value name" bind:value={o.label} />
                  <button class="icon-btn" aria-label="Move {o.label} up" disabled={j === 0} onclick={() => moveOption(j, -1)}
                    ><Icon name="up" /></button
                  >
                  <button
                    class="icon-btn"
                    aria-label="Move {o.label} down"
                    disabled={j === (draft.options?.length ?? 0) - 1}
                    onclick={() => moveOption(j, 1)}><Icon name="down" /></button
                  >
                  {#if o.role}
                    <span class="icon-btn locked" role="img" aria-label="{o.label} can't be removed" title="Can be renamed, not removed"
                      ><Icon name="lock" /></span
                    >
                  {:else}
                    <button class="icon-btn" aria-label="Remove {o.label}" onclick={() => removeOption(j)}><Icon name="trash" /></button>
                  {/if}
                </div>
                <HuePicker bind:value={o.hue} slate label="Colour of {o.label}" />
              </div>
            {/each}
            {#if f.builtin === 'status'}
              <p class="hint">
                <Icon name="lock" size={14} /> The values for in progress and completed can be renamed but not removed: Boardo
                completes cards with them, and Elastic sets them when you start or finish a card.
              </p>
            {/if}
            <button class="btn" onclick={addOption}><Icon name="plus" /> Add a value</button>
          {/if}
          <div class="acts">
            <button class="key ink" disabled={!draft.name.trim()} onclick={save}>Save field</button>
            {#if !f.builtin}
              {#if armed}
                <span class="warn">Its value goes from every card.</span>
                <button class="btn danger" onclick={() => ((open = null), app.removeField(b.id, f.id))}>Remove</button>
              {:else}
                <button class="btn danger" onclick={() => (armed = true)}><Icon name="trash" /> Remove field</button>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </li>
  {/each}
</ul>

{#if adding}
  <form class="new" onsubmit={add}>
    <label class="label" for="nf-name">New field</label>
    <input id="nf-name" class="field" placeholder="Channel" maxlength="100" bind:value={newName} />
    <select class="field" aria-label="Type" bind:value={newType}>
      {#each Object.entries(TYPE_NAMES) as [t, n] (t)}<option value={t}>{n}</option>{/each}
    </select>
    <div class="acts">
      <button class="key ink" type="submit" disabled={!newName.trim()}>Add field</button>
      <button class="btn ghost" type="button" onclick={() => (adding = false)}>Cancel</button>
    </div>
  </form>
{:else}
  <button class="btn" onclick={() => (adding = true)}><Icon name="plus" /> Add a field</button>
{/if}

<style>
  .fields {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--raised);
  }
  li + li {
    border-top: 1px solid var(--border);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 12px;
  }
  .row :global(.icon-btn:disabled) {
    opacity: 0.3;
  }
  .name {
    flex: 1;
    min-width: 0;
    display: grid;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  small {
    color: var(--faint);
    font-weight: 400;
    font-size: 12.5px;
  }
  .btn.small {
    min-height: 36px;
    padding: 0 12px;
    font-size: 13px;
  }
  .edit {
    display: grid;
    gap: 8px;
    padding: 4px 12px 14px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }
  .check input {
    width: 20px;
    height: 20px;
  }
  .opt {
    display: grid;
    gap: 6px;
    padding: 8px 0;
    border-top: 1px dashed var(--border);
  }
  .opt-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .opt-row .field {
    flex: 1;
    min-width: 0;
  }
  .opt-row :global(.icon-btn:disabled) {
    opacity: 0.3;
  }
  .locked {
    cursor: default;
  }
  .hint {
    margin: 0;
    display: flex;
    gap: 6px;
    align-items: flex-start;
    color: var(--muted);
    font-size: 13px;
  }
  .hint :global(svg) {
    margin-top: 2px;
  }
  .opt-row :global(.status) {
    display: none;
  }
  .acts {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .warn {
    font-size: 13px;
    color: var(--redT);
  }
  .new {
    display: grid;
    gap: 8px;
    margin-top: 10px;
  }
  .btn {
    justify-self: start;
  }
  :global(.fields + .btn) {
    margin-top: 10px;
  }
</style>
