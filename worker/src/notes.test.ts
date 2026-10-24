// Who hears about what (notes.ts).
import { describe, expect, it } from 'vitest';
import type { CardRec, CommentRec, FieldRec, MemberRec } from '../../shared/model';
import { cardNotes, commentNotes, memberNote, type NoteCtx } from './notes';

const member = (userId: string, name: string): MemberRec => ({ userId, name, email: `${userId}@x.com`, hue: 'indigo', role: 'member' });
const members = new Map([member('ann', 'Ann Lee'), member('bob', 'Bob Khan'), member('cy', 'Cy Ali')].map((m) => [m.userId, m]));
const status: FieldRec = {
  id: 'status',
  name: 'Status',
  type: 'dropdown',
  builtin: 'status',
  order: 0,
  options: [
    { id: 'not', label: 'Not started', hue: 'slate' },
    { id: 'prog', label: 'In progress', hue: 'indigo', role: 'in_progress' },
    { id: 'done', label: 'Completed', hue: 'lime', role: 'completed' },
  ],
} as FieldRec;
const card = (extra: Partial<CardRec> = {}): CardRec => ({
  id: 'k1',
  columnId: 'c1',
  order: 1,
  title: 'Write the email',
  desc: '',
  values: { status: 'not' },
  assignees: ['bob'],
  done: {},
  archived: false,
  createdBy: 'ann',
  created: 0,
  ...extra,
});
const ctx = (actor: string | null, cards: CardRec[] = []): NoteCtx => ({
  board: { id: 'b1', name: 'Launch', hue: 'cyan' },
  members,
  status,
  cards: () => cards,
  actor,
  now: 5,
});
const who = (out: { userId: string; note: { kind: string } }[]) => out.map((o) => `${o.userId}:${o.note.kind}`).sort();

describe('updates for a card', () => {
  it('tells people put on or taken off it, but not the one who did it', () => {
    expect(who(cardNotes(card(), card({ assignees: ['ann', 'cy'] }), ctx('ann')))).toEqual(['bob:unassigned', 'cy:assigned']);
  });
  it('tells someone newly mentioned in the description, with the line', () => {
    const out = cardNotes(card(), card({ desc: 'Plan\n@Cy can you help?' }), ctx('ann'));
    expect(who(out)).toEqual(['cy:mention']);
    expect(out[0].note).toMatchObject({ quote: '@Cy can you help?', title: 'Write the email', by: { name: 'Ann Lee' }, boardName: 'Launch' });
    expect(cardNotes(card({ desc: '@Cy' }), card({ desc: '@Cy again' }), ctx('ann'))).toEqual([]);
  });
  it("tells the card's people about a new status or due date", () => {
    const out = cardNotes(card(), card({ values: { status: 'prog', end: '2026-10-30' } }), ctx('cy'));
    expect(who(out)).toEqual(['ann:due', 'ann:status', 'bob:due', 'bob:status']);
    expect(out.find((o) => o.note.kind === 'status')!.note.to).toBe('In progress');
  });
  it('says Completed, by itself, and frees a card waiting on it', () => {
    const waiting = card({ id: 'k2', title: 'Send it', assignees: ['cy'], createdBy: 'cy', deps: ['k1'] });
    const out = cardNotes(card(), card({ values: { status: 'done' } }), ctx('bob', [card(), waiting]));
    expect(who(out)).toEqual(['ann:completed', 'cy:unblocked']);
    expect(out.find((o) => o.note.kind === 'unblocked')!.note).toMatchObject({ card: 'k2', title: 'Send it', dep: 'Write the email', by: null });
  });
  it('waits until every card it waits on is done', () => {
    const other = card({ id: 'k3', values: { status: 'not' } });
    const waiting = card({ id: 'k2', assignees: ['cy'], deps: ['k1', 'k3'] });
    expect(who(cardNotes(card(), card({ values: { status: 'done' } }), ctx('bob', [card(), other, waiting])))).toEqual(['ann:completed']);
  });
  it('leaves out people no longer in the board', () => {
    expect(cardNotes(card(), card({ assignees: ['bob', 'gone'] }), ctx('ann'))).toEqual([]);
  });
});

describe('updates for a comment', () => {
  const c = (text: string, userId = 'cy'): CommentRec => ({ id: 'm1', cardId: 'k1', userId, text, at: 1 });
  it("tells the card's people, and mentioned people once, as a mention", () => {
    const out = commentNotes(null, c('Done. @Ann Lee please look'), card(), ctx('cy'));
    expect(who(out)).toEqual(['ann:mention', 'bob:comment']);
    expect(out.find((o) => o.userId === 'bob')!.note.quote).toBe('Done. @Ann Lee please look');
  });
  it('tells only the newly mentioned when a comment is edited, and nobody when it is deleted', () => {
    expect(who(commentNotes(c('hi'), c('hi @Bob'), card(), ctx('cy')))).toEqual(['bob:mention']);
    expect(commentNotes(c('hi'), null, card(), ctx('cy'))).toEqual([]);
  });
});

describe('updates for the board', () => {
  it('tells someone added, given a role or taken out, unless they did it', () => {
    expect(memberNote('role', 'bob', 'admin', ctx('ann'))).toMatchObject([{ userId: 'bob', note: { kind: 'role', to: 'admin', card: null } }]);
    expect(memberNote('added', 'bob', 'member', ctx('bob'))).toEqual([]);
  });
});
