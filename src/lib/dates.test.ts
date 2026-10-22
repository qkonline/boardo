import { describe, expect, it } from 'vitest';
import { deadline, fromLocalInput, range, toLocalInput } from './dates';

const now = new Date(2026, 9, 22, 10, 0).getTime(); // Thursday 22 Oct 2026, 10 am

describe('deadline labels (R8.10)', () => {
  it.each([
    ['2026-10-21', 'Overdue'],
    ['2026-10-22', 'Due today'],
    ['2026-10-23', 'Due tomorrow'],
    ['2026-10-26', 'Monday'],
    ['2026-11-04', '4 Nov'],
    ['2027-01-04', '4 Jan 2027'],
  ])('%s reads %s', (end, label) => {
    expect(deadline(end, now)?.label).toBe(label);
  });
  it('includes the time when there is one', () => {
    expect(deadline(fromLocalInput('2026-10-22T17:00')!, now)?.label).toBe('Due today, 5 pm');
    expect(deadline(fromLocalInput('2026-10-22T09:30')!, now)?.label).toBe('Overdue');
  });
  it('is nothing without a date', () => expect(deadline(undefined, now)).toBeNull());
});

describe('date and time fields', () => {
  it('round-trip through local time', () => {
    const iso = fromLocalInput('2026-10-24T14:30')!;
    expect(iso).toMatch(/^2026-10-24T14:30:00[+-]\d{2}:\d{2}$/);
    expect(toLocalInput(iso)).toBe('2026-10-24T14:30');
  });
  it('show a range in one line', () => {
    expect(range('2026-10-24', '2026-10-28', now)).toBe('24 Oct to 28 Oct');
    expect(range(null, '2026-10-28', now)).toBe('28 Oct');
    expect(range(undefined, undefined, now)).toBe('');
  });
});
