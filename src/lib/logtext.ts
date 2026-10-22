// A log entry as a sentence: "Sara moved this card from Campaign 1 to Campaign 2".

import type { LogRec } from '../../shared/model';
import type { BoardState } from './board.svelte';
import { dayOf, hasTime, longDate } from './dates';
import { duration } from './dates';

const q = (v: unknown) => (v == null || v === '' ? 'nothing' : String(v));

/** A value as it reads in a sentence: dates in words, ticks as yes and no. */
function val(v: unknown): string {
  if (v === true) return 'ticked';
  if (v === false) return 'unticked';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return longDate(hasTime(v) ? v : dayOf(v));
  return q(v);
}

/**
 * Who did it (null: automatic) and what happened. `onCard` reads "this card" in a card's own
 * log; the project log names the card instead.
 */
export function logText(l: LogRec, b: BoardState, onCard: boolean): string {
  const name = (id: unknown) => (typeof id === 'string' ? (b.member.get(id)?.name ?? 'someone who left') : 'someone');
  const d = l.detail;
  const card = l.cardId ? b.card.get(l.cardId) : null;
  const it = onCard ? 'this card' : card ? `"${card.title || 'Untitled'}"` : 'a card';
  const its = onCard ? 'its' : `${it}'s`;
  switch (l.action) {
    case 'created':
      return onCard ? `created this card${d.column ? ` in ${d.column}` : ''}` : `added ${it}${d.column ? ` to ${d.column}` : ''}`;
    case 'archived':
      return `archived ${it}`;
    case 'restored':
      return `restored ${it}`;
    case 'deleted':
      return `deleted "${q(d.title)}"`;
    case 'moved':
      return `moved ${it} from ${q(d.from)} to ${q(d.to)}`;
    case 'renamed':
      return onCard ? `renamed this card from "${q(d.from)}" to "${q(d.to)}"` : `renamed "${q(d.from)}" to "${q(d.to)}"`;
    case 'described':
      return d.to ? `changed ${its} description` : `cleared ${its} description`;
    case 'status':
      return d.auto
        ? `${onCard ? 'This card' : it} became ${q(d.to)} automatically`
        : `${d.via === 'elastic' ? 'started work in Elastic, which set' : 'set'} ${its} status to ${q(d.to)}${d.from ? ` (was ${d.from})` : ''}`;
    case 'changed': {
      const f = q(d.name ?? 'a field');
      if (d.to == null || d.to === '') return `cleared ${f}${onCard ? '' : ` on ${it}`}`;
      return `set ${f}${onCard ? '' : ` on ${it}`} to ${val(d.to)}${d.from != null && d.from !== '' ? ` (was ${val(d.from)})` : ''}`;
    }
    case 'assigned':
      return d.user === l.userId ? `took ${it}` : `assigned ${it} to ${name(d.user)}`;
    case 'unassigned':
      return d.user === l.userId ? `took themselves off ${it}` : `took ${name(d.user)} off ${it}`;
    case 'part_done':
      return d.user === l.userId
        ? `finished their part of ${it}${d.via === 'elastic' ? ' in Elastic' : ''}`
        : `marked ${name(d.user)}'s part done`;
    case 'part_undone':
      return d.user === l.userId ? `marked their part of ${it} not done` : `marked ${name(d.user)}'s part not done`;
    case 'commented':
      return `commented on ${it}`;
    case 'file_added':
      return `attached ${q(d.name)}${onCard ? '' : ` to ${it}`}`;
    case 'file_removed':
      return `removed ${q(d.name)}${onCard ? '' : ` from ${it}`}`;
    case 'worked':
      return `worked ${duration(Number(d.ms) || 0)} on ${it}${d.from === 'elastic' ? ' in Elastic' : ''}`;
    case 'board_created':
      return `created the board`;
    case 'board_renamed':
      return `renamed the board from ${q(d.from)} to ${q(d.to)}`;
    case 'column_added':
      return `added the column ${q(d.name)}`;
    case 'column_renamed':
      return `renamed the column ${q(d.from)} to ${q(d.to)}`;
    case 'column_removed':
      return `removed the column ${q(d.name)}`;
    case 'field_added':
      return `added the field ${q(d.name)}`;
    case 'field_changed':
      return d.from && d.from !== d.name ? `renamed the field ${q(d.from)} to ${q(d.name)}` : `changed the field ${q(d.name)}`;
    case 'field_removed':
      return `removed the field ${q(d.name)}`;
    case 'member_added':
      return l.userId && l.userId !== d.user ? `added ${name(d.user)} as ${d.role === 'admin' ? 'an admin' : 'a member'}` : `${name(d.user)} joined`;
    case 'member_removed':
      return d.user === l.userId ? `left the board` : `removed ${name(d.user)}`;
    case 'background_changed':
      return d.to === 'none' ? 'took the background away' : `changed the background to ${d.to === 'image' ? 'an image' : 'a colour'}`;
    case 'role_changed':
      return `made ${name(d.user)} ${d.role === 'admin' ? 'an admin' : 'a member'}`;
  }
  return 'made a change';
}

/** Who to show at the front of the sentence, or null when the sentence stands alone. */
export function logWho(l: LogRec, b: BoardState): string | null {
  if (l.action === 'status' && l.detail.auto) return null;
  if (l.action === 'member_added' && (!l.userId || l.userId === l.detail.user)) return null;
  if (!l.userId) return 'Boardo';
  return b.member.get(l.userId)?.name ?? 'Someone who left';
}
