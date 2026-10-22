import { describe, expect, it } from 'vitest';
import { linkify } from './text';

describe('linkify', () => {
  it('finds links and leaves the rest as text', () => {
    expect(linkify('See https://example.com/a?b=1, then reply.')).toEqual([
      { text: 'See ' },
      { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { text: ', then reply.' },
    ]);
  });
  it('never links anything but http and https', () => {
    expect(linkify('javascript:alert(1) <b>x</b>')).toEqual([{ text: 'javascript:alert(1) <b>x</b>' }]);
  });
});
