import { describe, expect, it } from 'vitest';
import { blocks, enter, inline, list, mark } from './format';

const flat = (s: string) => inline(s).map((p) => [p.text, p.b ? 'b' : '', p.i ? 'i' : '', p.s ? 's' : '', p.href ? 'a' : ''].join(''));

describe('reading the marks', () => {
  it('bold, italic and struck through, nested too', () => {
    expect(flat('a **bold** b')).toEqual(['a ', 'boldb', ' b']);
    expect(flat('*it* and _it_')).toEqual(['iti', ' and ', 'iti']);
    expect(flat('~~gone~~')).toEqual(['gones']);
    expect(flat('**bold *both***')).toEqual(['bold b', 'bothbi']);
  });
  it('leaves stray marks and snake_case alone', () => {
    expect(flat('2 * 3 * 4')).toEqual(['2 * 3 * 4']);
    expect(flat('file_name_here')).toEqual(['file_name_here']);
    expect(flat('** not bold **')).toEqual(['** not bold **']);
  });
  it('keeps web addresses whole, bold or not', () => {
    expect(flat('see https://x.com/_a_ now')).toEqual(['see ', 'https://x.com/_a_a', ' now']);
    expect(flat('**https://x.com**')).toEqual(['https://x.comba']);
  });
  it('lists and paragraphs', () => {
    const bl = blocks('Intro\nmore\n\n- one\n- **two**\n3. three\n4. four');
    expect(bl.map((b) => b.kind)).toEqual(['p', 'ul', 'ol']);
    expect(bl[0].kind === 'p' && bl[0].lines.length).toBe(2);
    expect(bl[2].kind === 'ol' && bl[2].start).toBe(3);
  });
});

describe('the toolbar', () => {
  it('wraps a selection, and unwraps it again', () => {
    const on = mark('make this bold', 5, 9, 'b');
    expect(on).toEqual({ value: 'make **this** bold', start: 7, end: 11 });
    expect(mark(on.value, on.start, on.end, 'b')).toEqual({ value: 'make this bold', start: 5, end: 9 });
    expect(mark('**x**', 0, 5, 'b').value).toBe('x');
  });
  it('italic on bold text adds a star, and comes off without touching the bold', () => {
    const it1 = mark('**x**', 2, 3, 'i');
    expect(it1.value).toBe('***x***');
    expect(mark(it1.value, it1.start, it1.end, 'i').value).toBe('**x**');
    expect(mark('**x**', 2, 3, 'b').value).toBe('x');
  });
  it('keeps spaces outside, and marks each line on its own', () => {
    expect(mark('a b ', 0, 4, 'i').value).toBe('*a b* ');
    expect(mark('one\ntwo', 0, 7, 's').value).toBe('~~one~~\n~~two~~');
  });
  it('with nothing selected, the pair goes in around the cursor', () => {
    expect(mark('ab', 1, 1, 'b')).toEqual({ value: 'a****b', start: 3, end: 3 });
  });
  it('lists on and off, switching between kinds', () => {
    expect(list('a\nb', 0, 3, 'ul').value).toBe('- a\n- b');
    expect(list('- a\n- b', 0, 7, 'ul').value).toBe('a\nb');
    expect(list('- a\n- b', 0, 7, 'ol').value).toBe('1. a\n2. b');
    expect(list('x\nhere', 3, 3, 'ul').value).toBe('x\n- here');
    expect(list('x\n', 2, 2, 'ul')).toEqual({ value: 'x\n- ', start: 4, end: 4 });
  });
  it('Enter carries a list on, and an empty item ends it', () => {
    expect(enter('- a', 3)).toEqual({ value: '- a\n- ', start: 6, end: 6 });
    expect(enter('9. a', 4)?.value).toBe('9. a\n10. ');
    expect(enter('- a\n- ', 6)).toEqual({ value: '- a\n', start: 4, end: 4 });
    expect(enter('plain', 5)).toBeNull();
  });
});
