import { describe, expect, it } from 'vitest';
import { mentioned, mentionLine, mentionsIn } from './mentions';

const people = [
  { userId: 'sara', name: 'Sara Ali' },
  { userId: 'samir', name: 'Samir Naqvi' },
  { userId: 'kk', name: 'Kaiser Khan' },
  { userId: 'k2', name: 'Kaiser Zaman' },
];

describe('mentions', () => {
  it('finds a full name, whatever its case, and where it is', () => {
    expect(mentionsIn('Thanks @sara ali, and @Samir Naqvi!', people)).toEqual([
      { start: 7, end: 16, userId: 'sara' },
      { start: 22, end: 34, userId: 'samir' },
    ]);
  });
  it('takes a first name alone only when one person has it', () => {
    expect([...mentioned('@Sara can you look', people)]).toEqual(['sara']);
    expect([...mentioned('@Kaiser can you look', people)]).toEqual([]);
    expect([...mentioned('@Kaiser Khan can you look', people)]).toEqual(['kk']);
  });
  it('needs the name to end there, and ignores email addresses', () => {
    expect([...mentioned('@Saraswati', people)]).toEqual([]);
    expect([...mentioned('mail sara@example.com', people)]).toEqual([]);
    expect([...mentioned('(@Sara)', people)]).toEqual(['sara']);
  });
  it('quotes the line with the mention', () => {
    expect(mentionLine('First line\n  @Sara please check  \nlast', 'sara', people)).toBe('@Sara please check');
    const long = mentionLine('x'.repeat(200) + ' @Sara needs this', 'sara', people, 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.startsWith('…') && long.includes('@Sara')).toBe(true);
  });
});
