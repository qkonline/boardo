import { describe, expect, it } from 'vitest';
import type { CardRec, FieldRec } from '../../shared/model';
import { change, changeValue, clashes, draftPatch, draftWords, emptyDraft, settleClash, withDraft } from './draft';

const card = (extra: Partial<CardRec> = {}): CardRec => ({
  id: 'k', columnId: 'c', order: 1, title: 'Launch', desc: 'Old', values: {}, assignees: ['ben'], done: {}, archived: false, createdBy: 'ann', created: 0, ...extra,
});
const fields = new Map([['note', { id: 'note', type: 'longtext' } as FieldRec], ['status', { id: 'status', type: 'dropdown' } as FieldRec]]);

describe("a card's draft", () => {
  it('combines people added here with people added meanwhile', () => {
    const d = change(emptyDraft(), card(), 'assignees', ['ben', 'cat']);
    const now = card({ assignees: ['ben', 'ann'] });
    expect(draftPatch(now, d).assignees?.sort()).toEqual(['ann', 'ben', 'cat']);
    // Taking off someone who was added meanwhile works too.
    const d2 = change(d, now, 'assignees', ['ben', 'cat']);
    expect(draftPatch(now, d2).assignees).toEqual(['ben', 'cat']);
  });

  it('combines dependencies, and an empty list is a removal', () => {
    const d = change(emptyDraft(), card({ deps: ['x'] }), 'deps', []);
    expect(draftPatch(card({ deps: ['x', 'y'] }), d).deps).toEqual(['y']);
  });

  it('finds a text changed on both sides, and only then', () => {
    const d = change(emptyDraft(), card(), 'desc', 'Mine');
    expect(clashes(card(), d, fields)).toEqual([]);
    const now = card({ desc: 'Theirs', title: 'Renamed' });
    expect(clashes(now, d, fields)).toEqual([{ key: 'desc', mine: 'Mine', theirs: 'Theirs' }]);
    expect(clashes(card({ desc: 'Mine' }), d, fields)).toEqual([]);
    // Typing on doesn't move where the typing began.
    expect(clashes(now, change(d, now, 'desc', 'Mine more'), fields)).toHaveLength(1);
  });

  it('settles a clash either way', () => {
    const d = change(emptyDraft(), card(), 'desc', 'Mine');
    const now = card({ desc: 'Theirs' });
    const mine = settleClash(d, now, 'desc', 'mine');
    expect(clashes(now, mine, fields)).toEqual([]);
    expect(draftPatch(now, mine)).toEqual({ desc: 'Mine' });
    expect(draftPatch(now, settleClash(d, now, 'desc', 'theirs'))).toEqual({});
  });

  it('covers text fields, and leaves other fields alone', () => {
    let d = changeValue(emptyDraft(), card(), 'note', 'Mine', true);
    const now = card({ values: { note: 'Theirs', status: 's' } });
    expect(clashes(now, d, fields).map((c) => c.key)).toEqual(['note']);
    d = settleClash(d, now, 'note', 'mine');
    expect(draftPatch(now, d)).toEqual({ values: { note: 'Mine', status: 's' } });
    expect(settleClash(d, now, 'note', 'theirs')).toEqual(emptyDraft());
  });

  it("doesn't undo a teammate's change when mine was typed and taken back", () => {
    const d = change(change(emptyDraft(), card(), 'desc', 'Mine'), card(), 'desc', 'Old');
    const now = card({ desc: 'Theirs' });
    expect(draftPatch(now, d)).toEqual({});
    expect(clashes(now, d, fields)).toEqual([]);
    expect(withDraft(now, d).desc).toBe('Theirs');
  });

  it('keeps the words of a draft', () => {
    const d = change(emptyDraft(), card(), 'desc', 'Mine');
    expect(draftWords({ title: 'Launch', draft: d, comment: ' Hi ', edit: null, at: 0 })).toEqual([
      { kind: 'card', data: { title: 'Launch', desc: 'Mine' } },
      { kind: 'comment', data: { text: ' Hi ' } },
    ]);
  });
});
