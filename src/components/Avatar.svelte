<script lang="ts">
  import type { MemberRec } from '../../shared/model';
  import { hueColor, initials, inkOn } from '../lib/hue';

  /** A person as a small coloured square with their initials. */
  let { person, size = 24 }: { person: Pick<MemberRec, 'name' | 'hue'> | null | undefined; size?: number } = $props();
  const bg = $derived(hueColor(person?.hue));
</script>

<span
  class="av"
  style:width="{size}px"
  style:height="{size}px"
  style:background={person ? bg : 'var(--line)'}
  style:color={person ? inkOn(bg) : 'var(--muted)'}
  style:font-size="{Math.round(size * 0.42)}px"
  title={person?.name ?? 'Someone who left'}
  aria-hidden="true">{person ? initials(person.name) : '?'}</span
>

<style>
  .av {
    display: inline-grid;
    place-items: center;
    border-radius: 6px;
    font-weight: 600;
    flex: none;
    line-height: 1;
    letter-spacing: 0.02em;
  }
</style>
