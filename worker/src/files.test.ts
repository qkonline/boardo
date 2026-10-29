import { describe, expect, it } from 'vitest';
import { fakeD1 } from '../../test/fake-d1';
import { links, plainText, serve, sniff, typeOf } from './files';

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
  it('takes CSV that reads as text, in any encoding, and nothing else under that name', () => {
    expect(typeOf('Budget.CSV')).toEqual({ kind: 'text', mime: 'text/csv' });
    expect(plainText(bytes('name,amount\r\nCafé,4.50\n'))).toBe(true);
    expect(plainText(bytes('Caf', 0xe9, ',4\n'))).toBe(true);
    expect(plainText(bytes('MZ', 0x90, 0x00, 0x03))).toBe(false);
    expect(plainText(bytes('%PDF-1.7'))).toBe(false);
    expect(plainText(zip('[Content_Types].xml'))).toBe(false);
  });
});

describe('signed file links (R11.5)', () => {
  const f = { id: 'f1', cardId: 'k1', name: 'plan.pdf', mime: 'application/pdf', size: 3, by: 'ann', at: 1, thumb: false };
  function setup() {
    const { db, d1 } = fakeD1();
    db.exec(`INSERT INTO members (board_id, user_id, role, added_at) VALUES ('b1', 'ann', 'member', 1)`);
    const board = { filesById: async () => [f], fileInfo: async () => f };
    return {
      DB: d1,
      FILE_SIGNING_KEY: 'test-key',
      BOARDS: { idFromName: (n: string) => n, get: () => board },
      FILES: { get: async () => ({ body: 'pdf', size: 3, httpMetadata: { contentType: 'application/pdf' } }) },
    } as any;
  }
  const open = (env: any, url: string) => serve(new Request(url), env, new URL(url).pathname.replace(/^\/api/, ''));

  it('opens for an hour, as a download', async () => {
    const env = setup();
    const { links: l } = await links(env, 'ann', { board: 'b1', files: ['f1'] }, 'https://boardo.kaiserkhan.com/api');
    const res = await open(env, l.f1.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('is refused once it has expired', async () => {
    const env = setup();
    const { links: l } = await links(env, 'ann', { board: 'b1', files: ['f1'] }, 'https://boardo.kaiserkhan.com/api');
    const u = new URL(l.f1.url);
    u.searchParams.set('exp', String(Date.now() - 1));
    expect((await open(env, u.toString())).status).toBe(403);
  });

  it('is refused when anything in it is changed', async () => {
    const env = setup();
    const { links: l } = await links(env, 'ann', { board: 'b1', files: ['f1'] }, 'https://boardo.kaiserkhan.com/api');
    const u = new URL(l.f1.url);
    const later = new URL(u);
    later.searchParams.set('exp', String(Number(u.searchParams.get('exp')) + 3_600_000));
    expect((await open(env, later.toString())).status).toBe(403);
    const other = new URL(u);
    other.pathname = other.pathname.replace('/f1', '/f2');
    expect((await open(env, other.toString())).status).toBe(403);
    const thumb = new URL(u);
    thumb.pathname += '/thumb';
    expect((await open(env, thumb.toString())).status).toBe(403);
    const sig = new URL(u);
    sig.searchParams.set('sig', u.searchParams.get('sig')!.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')));
    expect((await open(env, sig.toString())).status).toBe(403);
  });

  it('is only given to members of the board', async () => {
    await expect(links(setup(), 'bob', { board: 'b1', files: ['f1'] }, 'https://x')).rejects.toThrow(/isn't there/);
  });
});
