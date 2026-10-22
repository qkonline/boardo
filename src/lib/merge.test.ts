import { describe, expect, it } from 'vitest';
import type { CardRec } from '../../shared/model';
import { mergeCard } from './merge';

const card = (extra: Partial<CardRec> = {}): CardRec => ({
  id: 'c',
  columnId: 'k',
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

describe('merging dependencies', () => {
  it("keeps cards both people added and drops what either removed", () => {
    const base = card({ deps: ['a', 'b'] });
    const mine = card({ deps: ['a', 'b', 'c'] });
    const theirs = card({ deps: ['b', 'd'] });
    expect(mergeCard(base, mine, theirs).deps).toEqual(['b', 'd', 'c']);
  });
  it('leaves cards without dependencies without the list', () => {
    expect('deps' in mergeCard(card(), card({ title: 'New' }), card())).toBe(false);
    expect('deps' in mergeCard(card({ deps: ['a'] }), card({ deps: [] }), card({ deps: ['a'] }))).toBe(false);
  });
});
