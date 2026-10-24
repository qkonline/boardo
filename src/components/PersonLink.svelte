<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MemberRec } from '../../shared/model';
  import type { BoardState } from '../lib/board.svelte';
  import Balloon from './Balloon.svelte';
  import PersonCard from './PersonCard.svelte';

  /**
   * A person's name, mention or face that opens who they are (PersonCard) in a balloon. Someone
   * no longer in the board stays plain.
   */
  let {
    person,
    b,
    align = 'start',
    children: face,
  }: { person: MemberRec | null | undefined; b?: BoardState; align?: 'start' | 'end'; children: Snippet } = $props();

  /** Below the name, or above it when the name is low on the screen. */
  let place = $state<'below' | 'above'>('below');
</script>

{#if person}
  <Balloon label="About {person.name}" {align} {place}>
    {#snippet trigger({ toggle, open })}
      <button
        type="button"
        class="plink"
        aria-expanded={open}
        aria-label="About {person.name}"
        onclick={(e) => {
          e.stopPropagation();
          if (!open) place = e.currentTarget.getBoundingClientRect().bottom > window.innerHeight * 0.55 ? 'above' : 'below';
          toggle();
        }}>{@render face()}</button
      >
    {/snippet}
    {#snippet children()}
      <PersonCard {person} {b} />
    {/snippet}
  </Balloon>
{:else}
  {@render face()}
{/if}

<style>
  .plink {
    display: inline-flex;
    align-items: center;
    gap: inherit;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: inherit;
    cursor: pointer;
    border-radius: 4px;
  }
  @media (hover: hover) {
    .plink:hover {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  }
</style>
