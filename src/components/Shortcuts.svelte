<script lang="ts">
  import { app } from '../lib/store.svelte';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';

  /** The keyboard shortcuts, opened with "?" when nothing else has the keys. */
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const cmd = mac ? '⌘' : 'Ctrl';
  const shift = mac ? '⇧' : 'Shift';
  const groups: { name: string; keys: [string[], string][] }[] = [
    {
      name: 'Anywhere',
      keys: [
        [[`${cmd} K`], 'Search all boards, on Boards'],
        [['/'], "Search the board you're on"],
        [['?'], 'Show these shortcuts'],
        [['Esc'], 'Close what is open'],
      ],
    },
    {
      name: 'Boards',
      keys: [[['Alt ←', 'Alt →'], 'Move a board in your order']],
    },
    {
      name: 'A card',
      keys: [
        [['Enter'], 'Save the changes, then close it'],
        [['Esc'], 'Close it, asking first if there are changes'],
        [[`${cmd} Enter`], 'Post a comment'],
        [['←', '→'], 'Move between Details and History'],
      ],
    },
    {
      name: 'Writing',
      keys: [
        [[`${cmd} B`], 'Bold'],
        [[`${cmd} I`], 'Italic'],
        [[`${cmd} ${shift} X`], 'Strikethrough'],
        [[`${cmd} ${shift} 8`], 'Bulleted list'],
        [[`${cmd} ${shift} 7`], 'Numbered list'],
        [['@'], 'Mention someone in the board'],
      ],
    },
  ];
</script>

<Sheet variant="form" label="Keyboard shortcuts" onclose={() => (app.sheet = null)}>
  <div class="body">
    <div class="top">
      <h2>Keyboard shortcuts</h2>
      <button type="button" class="icon-btn" aria-label="Close" data-autofocus onclick={() => (app.sheet = null)}><Icon name="close" /></button>
    </div>
    {#each groups as g (g.name)}
      <section>
        <h3>{g.name}</h3>
        <dl>
          {#each g.keys as [keys, what] (what)}
            <div class="row">
              <dt>{#each keys as k, i (k)}{#if i}<span class="or">or</span>{/if}<kbd>{k}</kbd>{/each}</dt>
              <dd>{what}</dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
</Sheet>

<style>
  .body {
    display: grid;
    gap: 14px;
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
  h3 {
    margin: 0 0 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
  }
  dl {
    margin: 0;
    display: grid;
    gap: 6px;
  }
  .row {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 12px;
    align-items: center;
  }
  dt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  dd {
    margin: 0;
    font-size: 14px;
  }
  .or {
    color: var(--muted);
    font-size: 12.5px;
  }
  kbd {
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--raised);
    color: var(--text);
    font: 500 12.5px var(--font);
    white-space: nowrap;
  }
</style>
