<script lang="ts">
  import type { FieldOption } from '../../shared/model';
  import { statusColors } from '../lib/hue';

  let { option }: { option: FieldOption | undefined } = $props();
  const c = $derived(statusColors(option?.hue ?? 'slate'));
</script>

{#if option}
  <span class="status" style:background={c.tint} style:color={c.text}
    ><span class="dot" style:background={c.bar}></span>{option.label}</span
  >
{/if}

<style>
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: 500 12.5px/1 var(--font);
    padding: 5px 8px;
    border-radius: var(--r-sm);
    white-space: nowrap;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
  }
</style>
