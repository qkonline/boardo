import { describe, expect, it } from 'vitest';
import { sniff, typeOf } from './files';

const bytes = (...b: (number | string)[]) =>
  new Uint8Array(b.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));

/** A zip whose first entry is `name`, as Office documents start. */
function zip(name: string) {
  const head = new Uint8Array(30 + name.length);
  head.set([0x50, 0x4b, 0x03, 0x04]);
  head[26] = name.length;
  head.set(new TextEncoder().encode(name), 30);
  return head;
}

describe('file types by their first bytes (R4.16)', () => {
  it('knows the kinds that are taken', () => {
    expect(sniff(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpg');
    expect(sniff(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(sniff(bytes('GIF89a'))).toBe('gif');
    expect(sniff(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('webp');
    expect(sniff(bytes('%PDF-1.7'))).toBe('pdf');
    expect(sniff(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe('ole');
    expect(sniff(zip('[Content_Types].xml'))).toBe('ooxml');
    expect(sniff(zip('word/document.xml'))).toBe('ooxml');
  });
  it('refuses programs, scripts and other zips', () => {
    expect(sniff(bytes('MZ', 0x90, 0))).toBeNull();
    expect(sniff(bytes('<script>'))).toBeNull();
    expect(sniff(zip('payload.exe'))).toBeNull();
  });
  it('reads the claimed type from the name', () => {
    expect(typeOf('Plan.DOCX')?.kind).toBe('ooxml');
    expect(typeOf('photo.jpeg')?.mime).toBe('image/jpeg');
    expect(typeOf('setup.exe')).toBeNull();
    expect(typeOf('noextension')).toBeNull();
  });
});
