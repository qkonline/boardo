<script lang="ts">
  import type { FieldRec, MemberRec } from '../../shared/model';
  import { fromLocalInput, toLocalInput } from '../lib/dates';

  type Value = string | number | boolean | null;

  /** The editor for one field's value on a card. Changes are saved when the field is left. */
  let {
    field,
    value,
    members,
    id,
    onsave,
  }: { field: FieldRec; value: Value | undefined; members: MemberRec[]; id: string; onsave: (v: Value) => void } =
    $props();

  const str = (v: Value | undefined) => (v == null ? '' : String(v));

  function commitText(e: Event) {
    const v = (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
    if (v !== str(value)) onsave(v === '' ? null : v);
  }
  function commitNumber(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value.trim();
    const n = raw === '' ? null : Number(raw);
    if (n !== null && !Number.isFinite(n)) return;
    if (n !== (value ?? null)) onsave(n);
  }
  function commitDate(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    onsave(v || null);
  }
  function commitDateTime(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    onsave(fromLocalInput(v));
  }
</script>

{#if field.type === 'text'}
  <input {id} class="field" maxlength="500" value={str(value)} onchange={commitText} />
{:else if field.type === 'longtext'}
  <textarea {id} class="field" rows="3" maxlength="5000" value={str(value)} onchange={commitText}></textarea>
{:else if field.type === 'number'}
  <input {id} class="field" type="text" inputmode="decimal" value={str(value)} onchange={commitNumber} />
{:else if field.type === 'date'}
  <input {id} class="field" type="date" value={typeof value === 'string' ? value.slice(0, 10) : ''} onchange={commitDate} />
{:else if field.type === 'datetime'}
  <input
    {id}
    class="field"
    type="datetime-local"
    value={typeof value === 'string' ? toLocalInput(value) : ''}
    onchange={commitDateTime}
  />
{:else if field.type === 'dropdown'}
  <select {id} class="field" value={str(value)} onchange={(e) => onsave(e.currentTarget.value || null)}>
    <option value="">Not set</option>
    {#each field.options ?? [] as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
  </select>
{:else if field.type === 'checkbox'}
  <button
    {id}
    type="button"
    class="switch"
    class:on={value === true}
    role="switch"
    aria-checked={value === true}
    aria-label={field.name}
    onclick={() => onsave(value === true ? null : true)}><span></span></button
  >
{:else if field.type === 'person'}
  <select {id} class="field" value={str(value)} onchange={(e) => onsave(e.currentTarget.value || null)}>
    <option value="">Nobody</option>
    {#each members as m (m.userId)}<option value={m.userId}>{m.name}</option>{/each}
    {#if typeof value === 'string' && value && !members.some((m) => m.userId === value)}
      <option value={value}>Someone who left</option>
    {/if}
  </select>
{/if}
