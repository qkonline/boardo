<script lang="ts">
  import { app } from '../lib/store.svelte';

  // Saving on this device is failing. The latest changes live only in this window until a save
  // works, so say so, keep trying, and offer a backup that includes them (as Elastic does).
</script>

{#if app.saveError}
  <div class="banner" role="alert">
    <p class="t">
      {app.saveError === 'full' ? "This device is out of storage, so Boardo can't save." : "Boardo can't save on this device right now."}
    </p>
    <p class="s">Your latest changes are only in this window until it can. It keeps trying. Download a backup to keep them safe.</p>
    <button class="btn" onclick={() => app.downloadUnsaved()}>Download a backup</button>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    z-index: 40;
    top: max(10px, env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, calc(100% - 2 * var(--px)));
    padding: 12px 12px 12px 16px;
    border-radius: var(--r-card);
    background: color-mix(in oklab, var(--rose) 8%, var(--raised));
    box-shadow:
      inset 0 0 0 1.5px color-mix(in oklab, var(--rose) 55%, transparent),
      0 8px 24px rgb(0 0 0 / 0.12);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  p {
    margin: 0;
  }
  .t {
    font: 400 15px/1.3 var(--font);
    color: var(--redT);
  }
  .s {
    font: 400 13px/1.45 var(--font);
    color: var(--muted);
    text-wrap: pretty;
  }
  .btn {
    margin-top: 6px;
  }
</style>
