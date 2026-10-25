import { describe, expect, it } from 'vitest';
import type { LogRec } from '../../shared/model';
import { feed, span } from './feed';

const at = (h: number, m: number, day = 23) => new Date(2026, 9, day, h, m).getTime();
let n = 0;
const log = (userId: string | null, cardId: string | null, t: number): LogRec => ({ id: `l${n++}`, cardId, userId, at: t, action: 'changed', detail: {} });

describe('the Activity feed', () => {
  it("groups a person's changes close together, and their changes by card", () => {
    const days = feed([
      log('ann', 'k1', at(6, 51)),
      log('ann', 'k2', at(6, 49)),
      log('ann', 'k1', at(6, 47)),
      log('ann', null, at(6, 43)),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].runs).toHaveLength(1);
    expect(days[0].runs[0].cards.map((g) => [g.cardId, g.logs.length])).toEqual([
      ['k1', 2],
      ['k2', 1],
      [null, 1],
    ]);
  });
  it('starts a new run for another person, a long gap or another day', () => {
    const days = feed([log('ann', 'k1', at(9, 0)), log('bob', 'k1', at(8, 59)), log('bob', 'k1', at(8, 0)), log('bob', 'k1', at(18, 0, 22))]);
    expect(days.map((d) => d.runs.map((r) => r.userId))).toEqual([['ann', 'bob', 'bob'], ['bob']]);
  });
  it('keeps something that happened by itself with the change that set it off', () => {
    const days = feed([log(null, 'k1', at(9, 0)), log('ann', 'k1', at(9, 0)), log(null, 'k1', at(7, 0))]);
    expect(days[0].runs.map((r) => r.userId)).toEqual([null, 'ann', null]);
    const joined = feed([log('ann', 'k1', at(9, 1)), log(null, 'k1', at(9, 0)), log('ann', 'k1', at(8, 59))]);
    expect(joined[0].runs).toHaveLength(1);
  });
  it('says the time once, or the span', () => {
    expect(span({ oldest: at(6, 51), newest: at(6, 51) })).toBe('6:51 am');
    expect(span({ oldest: at(6, 43), newest: at(6, 51) })).toBe('6:43 to 6:51 am');
    expect(span({ oldest: at(11, 50), newest: at(12, 10) })).toBe('11:50 am to 12:10 pm');
  });
});
