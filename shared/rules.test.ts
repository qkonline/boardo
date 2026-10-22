import { describe, expect, it } from 'vitest';
import { type CardRec, STATUS_FIELD } from './model';
import { cardChanges, settle } from './rules';

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
  it('logs a new card once', () => {
    expect(cardChanges(null, card(), fields, cols)).toEqual([
      { action: 'created', detail: { title: 'Write the launch email', column: 'Campaign 1' } },
    ]);
  });
});
