// The nightly copies: each board's whole text, one board's failure not stopping the rest, and a
// deleted board coming back from its copy.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { member, startServer, type FakeServer } from '../../test/fake-board';
import { backUp } from './backup';
import type { Env } from './env';

let server: FakeServer;
let kept: Map<string, string>;
const at = Date.UTC(2026, 10, 24, 21, 17);

beforeEach(() => {
  server = startServer();
  kept = new Map();
});

const bucket = { put: async (k: string, v: string) => void kept.set(k, v) };
const rows = (id: string) =>
  server.boards.get(id)!.ctx.storage.sql.exec('SELECT kind, key, data FROM records WHERE data IS NOT NULL ORDER BY kind, key').toArray();

function env(broken?: string): Env {
  for (const { board } of server.boards.values()) board.env.BACKUPS = bucket;
  return {
    DB: server.d1.d1,
    BACKUPS: bucket,
    BOARDS: {
      idFromName: (id: string) => id,
      get: (id: string) =>
        id === broken ? { backUp: async () => Promise.reject(new Error('down')) } : server.boards.get(id)!.board,
      getByName: (id: string) => (id === broken ? { backUp: async () => Promise.reject(new Error('down')) } : server.boards.get(id)!.board),
    },
  } as unknown as Env;
}

async function board(id: string) {
  const b = await server.create(id, member('ann', 'admin'));
  server.d1.db.prepare('INSERT INTO boards (id, name, hue, created_by, created) VALUES (?, ?, ?, ?, 1)').run(id, id, 'cyan', 'ann');
  return b;
}

describe('nightly backups', () => {
  it('keeps each board under its day, and a board comes back from its copy as it was', async () => {
    const b1 = await board('b1');
    await b1.httpSync('ann', 'admin', {
      t: 'put',
      id: 1,
      recs: [{ kind: 'column', key: 'c1', base: 0, data: { id: 'c1', name: 'Line\nbreak \u2028 "quoted"', order: 1 } }],
    });
    await board('b2');
    expect(await backUp(env(), at)).toEqual({ kept: 2, failed: 0 });
    expect([...kept.keys()].sort()).toEqual(['2026-11-24/b1.jsonl', '2026-11-24/b2.jsonl']);
    const before = rows('b1');
    expect(before.some((r) => r.kind === 'column')).toBe(true);

    const text = kept.get('2026-11-24/b1.jsonl')!;
    const head = JSON.parse(text.split('\n')[0]);
    expect(await b1.restore(text)).toBe(false);
    const fresh = await server.board('new');
    expect(await fresh.restore(text)).toBe(true);
    expect(rows('new')).toEqual(before);
    const least = server.boards.get('new')!.ctx.storage.sql.exec('SELECT MIN(rev) AS r FROM records').toArray()[0].r as number;
    expect(least).toBeGreaterThan(head.rev);
    expect((await fresh.info()).members.map((m) => m.userId)).toEqual(['ann']);
  });

  it('goes on when a board fails, and says so', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    await board('b1');
    await board('b2');
    expect(await backUp(env('b1'), at)).toEqual({ kept: 1, failed: 1 });
    expect([...kept.keys()]).toEqual(['2026-11-24/b2.jsonl']);
    expect(said).toHaveBeenCalled();
    said.mockRestore();
  });

  it('refuses text that is not a backup', async () => {
    expect(await (await server.board('x')).restore('{"hello":1}')).toBe(false);
  });
});
