import { describe, expect, it } from 'vitest';
import { clean } from './checks';

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
