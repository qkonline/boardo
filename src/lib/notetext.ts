// What an update in the bell says (the bell, Updates.svelte; and the alert, src/sw.js, which
// has its own short copy of `line()`): a sentence in pieces, the names in bold, and how long ago.

import type { Note, NoteKind } from '../../shared/model';
import { longDate } from './dates';

export type Piece = { text: string; strong?: boolean };

const role = (r: string | null | undefined) => (r === 'admin' ? 'an admin' : 'a member');

export function sentence(n: Note, now = Date.now()): Piece[] {
  const who: Piece = { text: n.by?.name ?? 'Someone', strong: true };
  const card: Piece = { text: n.title || 'a card', strong: true };
  const board: Piece = { text: n.boardName, strong: true };
  const t = (text: string): Piece => ({ text });
  switch (n.kind) {
    case 'mention':
      return [who, t(' mentioned you in '), card];
    case 'assigned':
      return [who, t(' added you to '), card];
    case 'unassigned':
      return [who, t(' took you off '), card];
    case 'comment':
      return [who, t(' commented on '), card];
    case 'status':
      return n.to ? [who, t(' set '), card, t(' to '), { text: n.to, strong: true }] : [who, t(' took the status off '), card];
    case 'completed':
      return [card, t(' is completed. Everyone has done their part.')];
    case 'due':
      return n.to ? [who, t(' moved the due date of '), card, t(' to '), t(longDate(n.to, now))] : [who, t(' took the due date off '), card];
    case 'unblocked':
      return [{ text: n.dep || 'A card', strong: true }, t(' is done, so you can start '), card];
    case 'added':
      return [who, t(' added you to '), board, t(` as ${role(n.to)}`)];
    case 'role':
      return [who, t(` made you ${role(n.to)} of `), board];
    case 'removed':
      return [who, t(' took you out of '), board];
  }
}

/** The sentence as plain text (for an alert, or a screen reader). */
export const line = (n: Note, now = Date.now()) => sentence(n, now).map((p) => p.text).join('');

/** The badge on the avatar: a colour and a mark for each kind. */
export const LOOK: Record<NoteKind, { colour: string; mark: string }> = {
  mention: { colour: 'var(--s-indigo)', mark: '@' },
  assigned: { colour: 'var(--s-lime)', mark: '+' },
  unassigned: { colour: 'var(--s-slate)', mark: '−' },
  comment: { colour: 'var(--s-cyan)', mark: '“' },
  status: { colour: 'var(--s-indigo)', mark: '◐' },
  completed: { colour: 'var(--go)', mark: '✓' },
  due: { colour: 'var(--s-yellow)', mark: '◷' },
  unblocked: { colour: 'var(--s-cyan)', mark: '→' },
  added: { colour: 'var(--s-rose)', mark: '★' },
  role: { colour: 'var(--s-rose)', mark: '★' },
  removed: { colour: 'var(--s-slate)', mark: '×' },
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** How long ago, briefly: "Just now", "5 min", "3 hr", "Yesterday", "Mon", "12 Oct". */
export function ago(ms: number, now = Date.now()): string {
  const m = Math.floor((now - ms) / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min`;
  const d = new Date(ms);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(d)) / 86_400_000);
  if (days === 0) return `${Math.floor(m / 60)} hr`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return DAYS[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}
