<script lang="ts">
  import type { MemberRec } from '../../shared/model';
  import { API } from '../lib/api';
  import { hueColor, initials, inkOn } from '../lib/hue';

  /** A person as a small coloured square with their initials. */
  type Person = Pick<MemberRec, 'name' | 'hue'> & { photo?: string | null; userId?: string; id?: string };
  let { person, size = 24, src }: { person: Person | null | undefined; size?: number; src?: string } = $props();
  const bg = $derived(hueColor(person?.hue));
  // Their profile photo, when they have one (or `src`, a photo not saved yet).
  const photo = $derived(
    src ?? (person?.photo && (person.userId ?? person.id) ? `${API}/photos/${person.userId ?? person.id}/${person.photo}` : null),
  );
</script>

{#if photo}
  <img class="av" src={photo} alt="" width={size} height={size} title={person?.name} loading="lazy" />
{:else}<span
  class="av"
  style:width="{size}px"
  style:height="{size}px"
  style:background={person ? bg : 'var(--line)'}
  style:color={person ? inkOn(bg) : 'var(--muted)'}
  style:font-size="{Math.round(size * 0.42)}px"
  title={person?.name ?? 'Someone who left'}
  aria-hidden="true">{person ? initials(person.name) : '?'}</span
>{/if}

<style>
  img.av {
    object-fit: cover;
    background: var(--sunk);
  }
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
