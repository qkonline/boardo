// A board's background image waits for Save: an upload alone never changes the board.
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardRec, FileRec } from '../../shared/model';
import { BOARD_FILE } from '../../shared/model';
import { member, startServer, type FakeServer } from '../../test/fake-board';

let server: FakeServer;
let deleted: string[];

const image = (id: string): FileRec => ({ id, cardId: BOARD_FILE, name: 'background.jpg', mime: 'image/jpeg', size: 9, by: 'ann', at: 1, thumb: false });

async function saveBoard(patch: Partial<BoardRec>) {
  const b = await server.board('b1');
  const ctx = server.boards.get('b1')!.ctx;
  const row = ctx.storage.sql.exec("SELECT rev, data FROM records WHERE kind = 'board' AND key = 'main'").toArray()[0];
  const now = JSON.parse(row.data as string) as BoardRec;
  // As a device sends it over its socket.
  (b as unknown as { put: (recs: unknown, who: unknown) => unknown }).put(
    [{ kind: 'board', key: 'main', base: row.rev, data: { ...now, ...patch } }],
    { userId: 'ann', role: 'admin' },
  );
}
const board = async () => ((await server.records('b1', 'board')) as BoardRec[])[0];
const files = async () => ((await server.records('b1', 'file')) as FileRec[]).map((f) => f.id).sort();

beforeEach(async () => {
  server = startServer();
  const b = await server.create('b1', member('ann', 'admin'));
  deleted = [];
  (b as unknown as { env: Record<string, unknown> }).env.FILES = { delete: async (keys: string[]) => void deleted.push(...keys) };
});

describe('a background image', () => {
  it('waits for Save after it is uploaded', async () => {
    await (await server.board('b1')).addBackground(image('i1'));
    expect((await board()).background ?? null).toBeNull();
    await saveBoard({ background: { image: 'i1' } });
    expect((await board()).background).toEqual({ image: 'i1' });
  });
  it('can only be one uploaded to the board', async () => {
    await saveBoard({ background: { image: 'nope' } });
    expect((await board()).background ?? null).toBeNull();
  });
  it('is cleaned up once replaced, taken away, or never saved', async () => {
    const b = await server.board('b1');
    await b.addBackground(image('i1'));
    await saveBoard({ background: { image: 'i1' } });
    await b.addBackground(image('i2'));
    // A second pick before Save replaces the first one waiting.
    await b.addBackground(image('i3'));
    expect(await files()).toEqual(['i1', 'i3']);
    expect(deleted).toContain('b1/i2');
    // Saved as none: the old image and the unsaved one both go.
    await saveBoard({ background: null });
    expect(await files()).toEqual([]);
    expect(deleted).toEqual(expect.arrayContaining(['b1/i1', 'b1/i3']));
  });
});
