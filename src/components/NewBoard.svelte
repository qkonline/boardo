<script lang="ts">
  import type { Hue } from '../../shared/model';
  import { app } from '../lib/store.svelte';
  import HuePicker from './HuePicker.svelte';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';

  let name = $state('');
  let hue = $state<Hue>('cyan');
  let busy = $state(false);
  let error = $state('');

  async function create(e: Event) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await app.createBoard(name.trim(), hue);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<Sheet variant="form" label="New board" onclose={() => (app.sheet = null)}>
  <form class="body" onsubmit={create}>
    <div class="top">
      <h2>New board</h2>
      <button type="button" class="icon-btn" aria-label="Close" onclick={() => (app.sheet = null)}
        ><Icon name="close" /></button
      >
    </div>
    <label class="label" for="bname">Name</label>
    <input id="bname" class="field" maxlength="100" placeholder="Spring launch" bind:value={name} data-autofocus required />
    <span class="label">Colour</span>
    <HuePicker bind:value={hue} />
    <p class="note">You'll be its admin, and can invite people from the board.</p>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <button class="key ink" type="submit" disabled={busy || !name.trim()}>Create board</button>
  </form>
</Sheet>

<style>
  .body {
    display: grid;
    gap: 10px;
    padding: 8px 20px max(20px, env(safe-area-inset-bottom));
    overflow: auto;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }
  .note {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 14px;
  }
  .err {
    margin: 0;
    color: var(--redT);
  }
  .key {
    margin-top: 6px;
  }
</style>
