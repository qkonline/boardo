<script lang="ts">
  import type { FieldOption } from '../../shared/model';
  import { statusColors } from '../lib/hue';

  let { option }: { option: FieldOption | undefined } = $props();
  const c = $derived(statusColors(option?.hue ?? 'slate'));
</script>

{#if option}
  <span class="status" style:background={c.tint} style:color={c.text} title={option.label}
    ><span class="dot" style:background={c.bar}></span><span class="status-text">{option.label}</span></span
  >
{/if}

<style>
  /* A long value shortens with an ellipsis where there isn't room, never wrapping. */
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    box-sizing: border-box;
    font: 500 12.5px/1 var(--font);
    padding: 5px 8px;
    border-radius: var(--r-sm);
    white-space: nowrap;
  }
  .status-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
  }
</style>
