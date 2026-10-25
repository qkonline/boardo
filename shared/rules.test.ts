import { describe, expect, it } from 'vitest';
import { type CardRec, STATUS_FIELD } from './model';
import { cardChanges, settle, statusAsPart, withNewCardDefaults } from './rules';

const card = (extra: Partial<CardRec> = {}): CardRec => ({
  id: 'c',
  columnId: 'k',
  order: 1,
  title: 'Write the launch email',
  desc: '',
  values: { status: 'prog' },
  assignees: ['ann', 'bob'],
  done: {},
  archived: false,
  createdBy: 'ann',
  created: 0,
  ...extra,
});

describe('completion (R5.1 to R5.5)', () => {
  it('waits for every part', () => {
    const r = settle(card(), card({ done: { ann: 1 } }), STATUS_FIELD);
    expect(r.auto).toBeNull();
    expect(r.card.values.status).toBe('prog');
  });
  it('completes when the last part is done', () => {
    const r = settle(card({ done: { ann: 1 } }), card({ done: { ann: 1, bob: 2 } }), STATUS_FIELD);
    expect(r.auto).toBe('completed');
    expect(r.card.values.status).toBe('done');
  });
  it('goes back to In progress when a part is undone', () => {
    const r = settle(card({ done: { ann: 1, bob: 2 }, values: { status: 'done' } }), card({ done: { ann: 1 }, values: { status: 'done' } }), STATUS_FIELD);
    expect(r.card.values.status).toBe('prog');
  });
  it('goes back to In progress when someone is added to a Completed card', () => {
    const prev = card({ done: { ann: 1, bob: 2 }, values: { status: 'done' } });
    const r = settle(prev, { ...prev, assignees: ['ann', 'bob', 'cy'] }, STATUS_FIELD);
    expect(r.card.values.status).toBe('prog');
  });
  it('leaves a status picked by hand, and the parts, alone', () => {
    const prev = card({ done: { ann: 1, bob: 2 }, values: { status: 'done' } });
    const r = settle(prev, { ...prev, values: { status: 'block' } }, STATUS_FIELD);
    expect(r.auto).toBeNull();
    expect(r.card.values.status).toBe('block');
    expect(r.card.done).toEqual({ ann: 1, bob: 2 });
  });
  it('drops the part of someone no longer assigned', () => {
    const r = settle(card({ done: { bob: 2 } }), card({ assignees: ['ann'], done: { bob: 2 } }), STATUS_FIELD);
    expect(r.card.done).toEqual({});
  });
  it('never completes a card nobody is on', () => {
    expect(settle(card(), card({ assignees: [] }), STATUS_FIELD).auto).toBeNull();
  });
});

describe('Completed by hand is Mark done (R5.5d)', () => {
  const both = (prev: CardRec, next: CardRec, actor: string) => settle(prev, statusAsPart(prev, next, actor, STATUS_FIELD, 7), STATUS_FIELD).card;
  it('alone on a card: Completed marks the part done, and the card stays Completed', () => {
    const one = card({ assignees: ['ann'] });
    const r = both(one, card({ assignees: ['ann'], values: { status: 'done' } }), 'ann');
    expect(r.values.status).toBe('done');
    expect(r.done).toEqual({ ann: 7 });
  });
  it('alone on a card: moving off Completed undoes the part, and the picked status stays', () => {
    const one = card({ assignees: ['ann'], values: { status: 'done' }, done: { ann: 1 } });
    const r = both(one, { ...one, values: { status: 'block' } }, 'ann');
    expect(r.values.status).toBe('block');
    expect(r.done).toEqual({});
  });
  it('with others: Completed marks only my part, and the card waits for theirs', () => {
    const r = both(card(), card({ values: { status: 'done' } }), 'ann');
    expect(r.done).toEqual({ ann: 7 });
    expect(r.values.status).toBe('prog');
    // Then Bob does the same, and it completes.
    const r2 = both(r, { ...r, values: { status: 'done' } }, 'bob');
    expect(r2.values.status).toBe('done');
    expect(Object.keys(r2.done).sort()).toEqual(['ann', 'bob']);
  });
  it('with others: moving a Completed card off it undoes only my part', () => {
    const all = card({ values: { status: 'done' }, done: { ann: 1, bob: 2 } });
    const r = both(all, { ...all, values: { status: 'block' } }, 'bob');
    expect(r.done).toEqual({ ann: 1 });
    expect(r.values.status).toBe('block');
  });
  it('someone not on the card just sets the status', () => {
    const r = both(card(), card({ values: { status: 'done' } }), 'cy');
    expect(r.done).toEqual({});
    expect(r.values.status).toBe('done');
  });
});

describe("a new card starts with the board's defaults (R3.7)", () => {
  const board = (newCards: { assignee: string | null; status: string | null } | null) => ({ name: 'B', hue: 'cyan' as const, maxUploadMB: 30, newCards });
  const fresh = () => card({ assignees: [], values: {} });
  it('takes the person and the status', () => {
    const c = withNewCardDefaults(fresh(), board({ assignee: 'bob', status: 'not' }), ['ann', 'bob'], STATUS_FIELD);
    expect(c.assignees).toEqual(['bob']);
    expect(c.values.status).toBe('not');
  });
  it("skips someone who left, or a status that's gone, and anything the card has already", () => {
    expect(withNewCardDefaults(fresh(), board({ assignee: 'gone', status: 'nope' }), ['ann'], STATUS_FIELD)).toEqual(fresh());
    const own = card({ assignees: ['ann'], values: { status: 'block' } });
    expect(withNewCardDefaults(own, board({ assignee: 'bob', status: 'not' }), ['ann', 'bob'], STATUS_FIELD)).toEqual(own);
    expect(withNewCardDefaults(fresh(), board(null), ['ann'], STATUS_FIELD)).toEqual(fresh());
  });
});

describe('what a change logs', () => {
  const fields = new Map([['status', STATUS_FIELD]]);
  const cols = new Map([
    ['k', 'Campaign 1'],
    ['m', 'Campaign 2'],
  ]);
  it('names columns, statuses and people', () => {
    const out = cardChanges(card(), card({ columnId: 'm', values: { status: 'block' }, assignees: ['ann'] }), fields, cols);
    expect(out).toEqual([
      { action: 'moved', detail: { from: 'Campaign 1', to: 'Campaign 2' } },
      { action: 'status', detail: { field: 'status', name: 'Status', from: 'In progress', to: 'Blocked' } },
      { action: 'unassigned', detail: { user: 'bob' } },
    ]);
  });
  it('logs the cards a card starts and stops waiting on', () => {
    const out = cardChanges(card({ deps: ['a', 'b'] }), card({ deps: ['b', 'd'] }), fields, cols);
    expect(out).toEqual([
      { action: 'linked', detail: { card: 'd' } },
      { action: 'unlinked', detail: { card: 'a' } },
    ]);
  });
  it('logs a new card once', () => {
    expect(cardChanges(null, card(), fields, cols)).toEqual([
      { action: 'created', detail: { title: 'Write the launch email', column: 'Campaign 1' } },
    ]);
  });
});
