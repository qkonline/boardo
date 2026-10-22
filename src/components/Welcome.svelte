<script lang="ts">
  import type { Hue } from '../../shared/model';
  import { app } from '../lib/store.svelte';
  import HuePicker from './HuePicker.svelte';

  /** First sign-in: a name (R2.2) and a colour, shown to the people in your boards. */
  let name = $state('');
  let hue = $state<Hue>((app.user?.hue as Hue) ?? 'indigo');
  let busy = $state(false);
  let error = $state('');

  async function save(e: Event) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await app.saveProfile({ name: name.trim(), hue });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<main class="wrap">
  <form class="card" onsubmit={save}>
    <h1>What should we call you?</h1>
    <p class="lede">People in your boards see this name next to your cards and comments.</p>
    <label class="label" for="name">Your name</label>
    <input id="name" class="field" autocomplete="name" maxlength="60" bind:value={name} required />
    <span class="label">Your colour</span>
    <HuePicker bind:value={hue} />
    <button class="key ink" type="submit" disabled={busy || !name.trim()}>Continue</button>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </form>
</main>

<style>
  .wrap {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px var(--px);
  }
  .card {
    width: min(400px, 100%);
    display: grid;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
  }
  .lede {
    margin: 0 0 6px;
    color: var(--muted);
  }
  .key {
    margin-top: 10px;
  }
  .err {
    margin: 0;
    color: var(--redT);
  }
</style>
