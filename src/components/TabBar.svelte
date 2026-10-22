<script lang="ts">
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';

  /** Boards, My cards and Settings: along the bottom on a phone, along the top on a computer. */
  const at = $derived(
    app.screen.name === 'mycards' ? 'mycards' : app.screen.name === 'settings' ? 'settings' : 'boards',
  );
  const offline = $derived(!app.online);
</script>

<nav class="bar" aria-label="Main">
  <a
    class="brand"
    href="./"
    onclick={(e) => {
      e.preventDefault();
      app.go({ name: 'home' });
    }}
  >
    <img src="{import.meta.env.BASE_URL}icon.svg?v=1" alt="" width="26" height="26" />Boardo
  </a>
  <div class="tabs">
    <button class="tab" aria-current={at === 'boards' ? 'page' : undefined} onclick={() => app.go({ name: 'home' })}>
      <Icon name="boards" size={22} /><span>Boards</span>
    </button>
    <button
      class="tab"
      aria-current={at === 'mycards' ? 'page' : undefined}
      onclick={() => app.go({ name: 'mycards' })}
    >
      <Icon name="mine" size={22} /><span>My cards</span>
    </button>
    <button
      class="tab"
      aria-current={at === 'settings' ? 'page' : undefined}
      onclick={() => app.go({ name: 'settings' })}
    >
      <Icon name="gear" size={22} /><span>Settings</span>
    </button>
  </div>
  {#if offline}
    <span class="off" title="Changes are saved here and sent once you're back online."
      ><Icon name="offline" size={16} /> Offline</span
    >
  {/if}
</nav>

<style>
  .bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    background: var(--raised);
    border-top: 1px solid var(--border);
    padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    display: flex;
    align-items: stretch;
  }
  .brand {
    display: none;
  }
  .tabs {
    display: flex;
    flex: 1;
  }
  .tab {
    flex: 1;
    min-height: var(--bar-h);
    border: none;
    background: none;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 3px;
    font: 500 11.5px/1 var(--font);
    color: var(--muted);
    cursor: pointer;
  }
  .tab[aria-current='page'] {
    color: var(--text);
    font-weight: 600;
  }
  .tab[aria-current='page'] span {
    box-shadow: 0 2px 0 var(--text);
  }
  .off {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 12.5px;
    color: var(--muted);
    background: var(--raised);
    border: 1px solid var(--border);
    padding: 5px 10px;
    border-radius: var(--r-ctl);
    white-space: nowrap;
  }

  @media (min-width: 768px) {
    .bar {
      position: sticky;
      top: 0;
      bottom: auto;
      border-top: none;
      border-bottom: 1px solid var(--border);
      padding: 0 var(--px);
      align-items: center;
      gap: 20px;
      height: 56px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font: 600 17px/1 var(--font);
      color: var(--text);
      text-decoration: none;
    }
    .brand img {
      border-radius: 6px;
    }
    .tabs {
      flex: none;
      gap: 4px;
    }
    .tab {
      min-height: 40px;
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      gap: 8px;
      padding: 0 12px;
      border-radius: var(--r-ctl);
      font-size: 14px;
    }
    .tab[aria-current='page'] {
      background: var(--sunk);
    }
    .tab[aria-current='page'] span {
      box-shadow: none;
    }
    .off {
      position: static;
      transform: none;
      margin-left: auto;
    }
  }
</style>
