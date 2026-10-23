import { describe, expect, it } from 'vitest';
import { changes, clean } from './checks';

const card = (extra: Record<string, unknown> = {}) => ({
  id: 'k1',
  columnId: 'c1',
  order: 1,
  title: 'Write the launch email',
  desc: '',
  values: {},
  assignees: [],
  done: {},
  archived: false,
  createdBy: 'ann',
  created: 0,
  ...extra,
});

describe('a card waiting on other cards', () => {
  it('keeps the list, once each', () => {
    expect(clean('card', 'k1', card({ deps: ['k2', 'k3', 'k2'] }))).toMatchObject({ deps: ['k2', 'k3'] });
  });
  it('leaves an empty list out', () => {
    expect('deps' in (clean('card', 'k1', card({ deps: [] })) as object)).toBe(false);
  });
  it('refuses a card waiting on itself, or a list that is not ids', () => {
    expect(clean('card', 'k1', card({ deps: ['k1'] }))).toBeNull();
    expect(clean('card', 'k1', card({ deps: 'k2' }))).toBeNull();
    expect(clean('card', 'k1', card({ deps: [7] }))).toBeNull();
  });
});

describe('a put with one record that does not pass', () => {
  it('refuses that record alone and keeps the rest', () => {
    const res = changes([
      { kind: 'card', key: 'k1', base: 0, data: card() },
      { kind: 'card', key: 'k2', base: 0, data: 'not a card' },
      { kind: 'log', key: 'l1', base: 0, data: {} },
      { kind: 'card', key: 'k3', base: -1, data: card({ id: 'k3' }) },
      { kind: 'card', key: 'k4', base: 0, data: card({ id: 'k4', title: 7 }) },
    ])!;
    expect(res.list.map((c) => c.key)).toEqual(['k1']);
    expect(res.bad.map((c) => c.key)).toEqual(['k2', 'l1', 'k3', 'k4']);
  });
  it('still refuses a message that is not a list of records', () => {
    expect(changes('x')).toBeNull();
    expect(changes([{ kind: 'card', base: 0, data: card() }])).toBeNull();
  });
});
