<script lang="ts" module>
  export type IconName =
    | 'back'
    | 'plus'
    | 'filter'
    | 'cal'
    | 'chat'
    | 'clip'
    | 'boards'
    | 'mine'
    | 'gear'
    | 'log'
    | 'check'
    | 'more'
    | 'close'
    | 'trash'
    | 'archive'
    | 'undo'
    | 'people'
    | 'mail'
    | 'left'
    | 'right'
    | 'clock'
    | 'link'
    | 'sun'
    | 'moon'
    | 'auto'
    | 'field'
    | 'offline'
    | 'smile'
    | 'send'
    | 'down'
    | 'up'
    | 'lock'
    | 'account'
    | 'file'
    | 'image';
</script>

<script lang="ts">
  /**
   * Two-tone icons, like Elastic's: an outline in the accent colour with one detail in rose.
   * `plain` draws everything in the current text colour (inside filled buttons).
   */
  let { name, size = 18, plain = false }: { name: IconName; size?: number; plain?: boolean } = $props();
  const a = $derived(plain ? 'currentColor' : 'var(--accent)');
  const r = $derived(plain ? 'currentColor' : 'var(--rose)');
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 20 20"
  fill="none"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'back'}
    <path d="M12.5 4 6.5 10l6 6" stroke={a} />
  {:else if name === 'left'}
    <path d="M12 5 7 10l5 5" stroke={a} />
  {:else if name === 'right'}
    <path d="m8 5 5 5-5 5" stroke={a} />
  {:else if name === 'down'}
    <path d="m5 8 5 5 5-5" stroke={a} />
  {:else if name === 'up'}
    <path d="m5 12 5-5 5 5" stroke={a} />
  {:else if name === 'account'}
    <circle cx="10" cy="7.2" r="3.2" stroke={a} />
    <path d="M3.8 17c.8-3.3 3.3-5 6.2-5s5.4 1.7 6.2 5" stroke={a} />
    <circle cx="10" cy="7.2" r="1" fill={r} stroke="none" />
  {:else if name === 'lock'}
    <rect x="4.5" y="9" width="11" height="8" rx="1.5" stroke={a} />
    <path d="M7 9V6.5a3 3 0 0 1 6 0V9" stroke={a} />
    <circle cx="10" cy="13" r="1.2" fill={r} stroke="none" />
  {:else if name === 'plus'}
    <path d="M10 4v12M4 10h12" stroke={a} stroke-width="1.8" />
  {:else if name === 'filter'}
    <path d="M3.5 5.5h13M6 10h8" stroke={a} />
    <path d="M8.5 14.5h3" stroke={r} />
  {:else if name === 'cal'}
    <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" stroke={a} />
    <path d="M3.5 8.5h13" stroke={r} />
    <path d="M7 3v3M13 3v3" stroke={a} />
  {:else if name === 'chat'}
    <path d="M3.5 4.5h13v8.5h-7l-3.5 3v-3h-2.5z" stroke={a} />
    <circle cx="8" cy="8.8" r="0.9" fill={r} stroke="none" />
    <circle cx="12" cy="8.8" r="0.9" fill={r} stroke="none" />
  {:else if name === 'clip'}
    <path d="M13 6.5 7.6 11.9a1.7 1.7 0 0 0 2.4 2.4l6-6a3.4 3.4 0 0 0-4.8-4.8l-6 6a5 5 0 0 0 7.1 7.1l4.2-4.2" stroke={a} />
  {:else if name === 'boards'}
    <rect x="3" y="3.5" width="4" height="13" rx="1" stroke={a} />
    <rect x="8.5" y="3.5" width="4" height="9" rx="1" stroke={a} />
    <rect x="14" y="3.5" width="3" height="5.5" rx="1" fill={r} stroke={r} />
  {:else if name === 'mine'}
    <rect x="3.5" y="3.5" width="13" height="13" rx="2" stroke={a} />
    <path d="m6.8 10.2 2.3 2.3 4.4-5" stroke={r} />
  {:else if name === 'gear'}
    <path d="M10 2.5 16.5 6.2v7.6L10 17.5 3.5 13.8V6.2z" stroke={a} />
    <circle cx="10" cy="10" r="2.3" fill={r} stroke="none" />
  {:else if name === 'log'}
    <path d="M4 5.5h12M4 10h12M4 14.5h7" stroke={a} />
    <circle cx="15" cy="14.5" r="1.6" fill={r} stroke="none" />
  {:else if name === 'check'}
    <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke={plain ? 'currentColor' : 'var(--s-lime)'} stroke-width="2" />
  {:else if name === 'more'}
    <circle cx="5" cy="10" r="1.3" fill={a} stroke="none" />
    <circle cx="10" cy="10" r="1.3" fill={a} stroke="none" />
    <circle cx="15" cy="10" r="1.3" fill={r} stroke="none" />
  {:else if name === 'close'}
    <path d="m5 5 10 10M15 5 5 15" stroke={plain ? 'currentColor' : 'var(--text)'} />
  {:else if name === 'trash'}
    <path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10h7.4l.8-10" stroke={plain ? 'currentColor' : 'var(--redT)'} />
  {:else if name === 'undo'}
    <path d="M7.5 5 4 8.5 7.5 12" stroke={plain ? 'currentColor' : r} />
    <path d="M4.5 8.5h7a4 4 0 0 1 0 8H9" stroke={plain ? 'currentColor' : a} />
  {:else if name === 'archive'}
    <rect x="3" y="4" width="14" height="4" rx="1" stroke={a} />
    <path d="M4.5 8v8h11V8" stroke={a} />
    <path d="M8 11h4" stroke={r} />
  {:else if name === 'people'}
    <circle cx="7.5" cy="7" r="2.6" stroke={a} />
    <path d="M2.8 16c.6-2.8 2.5-4.2 4.7-4.2s4.1 1.4 4.7 4.2" stroke={a} />
    <circle cx="14" cy="7.8" r="2" stroke={r} />
    <path d="M13.5 12c1.8 0 3.2 1.1 3.7 3.5" stroke={r} />
  {:else if name === 'mail'}
    <rect x="3" y="4.5" width="14" height="11" rx="1.5" stroke={a} />
    <path d="m3.5 5.5 6.5 5 6.5-5" stroke={r} />
  {:else if name === 'clock'}
    <circle cx="10" cy="10" r="6.5" stroke={a} />
    <path d="M10 6.5V10l2.5 1.8" stroke={r} />
  {:else if name === 'link'}
    <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9" stroke={a} />
    <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" stroke={r} />
  {:else if name === 'sun'}
    <circle cx="10" cy="10" r="3.2" stroke={r} />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke={a} />
  {:else if name === 'moon'}
    <path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z" stroke={a} />
    <circle cx="13.5" cy="5.5" r="1" fill={r} stroke="none" />
  {:else if name === 'auto'}
    <circle cx="10" cy="10" r="6.5" stroke={a} />
    <path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill={r} stroke="none" />
  {:else if name === 'field'}
    <rect x="3" y="5" width="14" height="10" rx="1.5" stroke={a} />
    <path d="M6 10h5" stroke={r} />
  {:else if name === 'offline'}
    <path d="M3 8.5a10 10 0 0 1 14 0M5.5 11.3a6.4 6.4 0 0 1 9 0" stroke={a} />
    <circle cx="10" cy="14.5" r="1.2" fill={r} stroke="none" />
    <path d="m3.5 3.5 13 13" stroke={r} />
  {:else if name === 'smile'}
    <circle cx="10" cy="10" r="6.5" stroke={a} />
    <path d="M7.3 11.8c.7 1 1.6 1.5 2.7 1.5s2-.5 2.7-1.5" stroke={r} />
    <circle cx="7.8" cy="8.3" r="0.9" fill={a} stroke="none" />
    <circle cx="12.2" cy="8.3" r="0.9" fill={a} stroke="none" />
  {:else if name === 'send'}
    <path d="M3.5 10 16.5 4l-4 12-2.5-5z" stroke={plain ? 'currentColor' : a} />
  {:else if name === 'file'}
    <path d="M5 2.5h6.5l3.5 3.5v11.5H5z" stroke={a} />
    <path d="M11.5 2.5V6H15" stroke={a} />
    <path d="M7.5 11h5M7.5 14h3" stroke={r} />
  {:else if name === 'image'}
    <rect x="3" y="4" width="14" height="12" rx="1.5" stroke={a} />
    <circle cx="7.5" cy="8" r="1.3" fill={r} stroke="none" />
    <path d="m3.5 14 4-3.5 3 2.5 2.5-2 3.5 3" stroke={a} />
  {/if}
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
