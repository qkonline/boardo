<script lang="ts">
  import { HUES, type Hue } from '../../shared/model';
  import { HUE_NAMES, hueColor } from '../lib/hue';

  let { value = $bindable(), slate = false, label = 'Colour' }: { value: Hue; slate?: boolean; label?: string } = $props();
  const list = $derived<Hue[]>(slate ? ['slate', ...HUES] : [...HUES]);
</script>

<div class="hues" role="radiogroup" aria-label={label}>
  {#each list as h (h)}
    <button
      type="button"
      role="radio"
      aria-checked={value === h}
      aria-label={HUE_NAMES[h]}
      class="sw"
      style:--c={hueColor(h)}
      onclick={() => (value = h)}
    ></button>
  {/each}
</div>

<style>
  .hues {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sw {
    width: 44px;
    height: 44px;
    border-radius: var(--r-ctl);
    border: 2px solid transparent;
    background: var(--c);
    cursor: pointer;
    box-shadow: inset 0 0 0 3px var(--bg);
  }
  .sw[aria-checked='true'] {
    border-color: var(--text);
  }
</style>
