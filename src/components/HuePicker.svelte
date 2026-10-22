<script lang="ts">
  import { untrack } from 'svelte';
  import { HUES, type Hue } from '../../shared/model';
  import { HUE_NAMES, hueColor } from '../lib/hue';

  /**
   * The five colours (and slate, for status values), plus a colour of your own, as in Elastic.
   * Until one is picked the last swatch shows the five as a wheel; then it fills the middle.
   */
  let { value = $bindable(), slate = false, label = 'Colour' }: { value: Hue; slate?: boolean; label?: string } = $props();
  const list = $derived<Hue[]>(slate ? ['slate', ...HUES] : [...HUES]);

  const isHex = (h: string | undefined): h is `#${string}` => !!h && /^#[0-9a-f]{6}$/i.test(h);
  const custom = $derived(isHex(value) ? value : null);
  let lastCustom = $state(untrack(() => (isHex(value) ? value : '#f472b6')));
  $effect(() => {
    if (custom) lastCustom = custom;
  });
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
  <label class="sw own" class:on={!!custom} title="Custom colour" style:--pick={custom ?? 'transparent'}>
    <!-- The real input sits on top, invisible, so a tap opens the system colour picker. -->
    <input
      type="color"
      aria-label="Custom colour"
      value={lastCustom}
      oninput={(e) => (value = e.currentTarget.value as Hue)}
      onclick={() => !custom && (value = lastCustom as Hue)}
    />
  </label>
</div>

<style>
  .hues {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    padding: 4px;
  }
  .sw {
    width: 40px;
    height: 40px;
    border-radius: var(--r-ctl);
    border: none;
    padding: 0;
    background: var(--c);
    cursor: pointer;
    position: relative;
  }
  /* The chosen one: a ring outside, with a gap of the page colour. */
  .sw[aria-checked='true'],
  .own.on {
    box-shadow:
      0 0 0 2px var(--bg),
      0 0 0 4px var(--text);
  }
  .own {
    background: conic-gradient(var(--hue-stops));
  }
  .own.on {
    border: 4px solid transparent;
    background:
      linear-gradient(var(--pick), var(--pick)) padding-box,
      conic-gradient(var(--hue-stops)) border-box;
  }
  input[type='color'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .own:has(input:focus-visible) {
    outline: 2px solid var(--text);
    outline-offset: 3px;
  }
</style>
