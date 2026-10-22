<script lang="ts">
  import { freshness, PULL } from '../lib/freshness.svelte';

  // The circle that slides down from the top while pulling to refresh.
  const progress = $derived(Math.min(1, freshness.pull / PULL));
</script>

{#if freshness.pull > 0 || freshness.refreshing}
  <div
    class="pull"
    class:settling={!freshness.pulling}
    style:transform="translate(-50%, {freshness.pull - 44}px)"
    style:opacity={freshness.refreshing ? 1 : progress}
    aria-hidden="true"
  >
    <span class="icon" class:spin={freshness.refreshing} class:ready={progress >= 1} style:rotate="{progress * 270}deg"
      >↻</span
    >
  </div>
{/if}
{#if freshness.refreshing}<span class="sr-only" role="status">Refreshing</span>{/if}

<style>
  .pull {
    position: fixed;
    left: 50%;
    top: calc(env(safe-area-inset-top) + 8px);
    z-index: 40;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--raised);
    border: 1px solid var(--border);
    box-shadow: 0 4px 14px -4px rgba(0, 0, 0, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .pull.settling {
    transition:
      transform 200ms ease,
      opacity 200ms ease;
  }
  .icon {
    font: 400 18px/1 var(--font);
    color: var(--muted);
    transition: color 150ms;
  }
  .icon.ready,
  .icon.spin {
    color: var(--accent);
  }
  .icon.spin {
    animation: spin 700ms linear infinite;
  }
  @keyframes spin {
    to {
      rotate: 360deg;
    }
  }
</style>
