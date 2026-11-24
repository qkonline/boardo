// What the real Board Durable Object refuses on its own: people not in its member list, a role
// above their member record, a removal it wasn't told of, a board that's full, and too many
// changes or updates too fast.
import { beforeEach, describe, expect, it } from 'vitest';
import type { CardRec } from '../../shared/model';
import { member, startServer, type FakeServer } from '../../test/fake-board';

let server: FakeServer;

const card = (id: string, extra: Partial<CardRec> = {}): CardRec => ({
  id,
  columnId: 'c1',
  order: 1,
  title: id,
  desc: '',
  values: {},
  assignees: [],
  done: {},
  archived: false,
  createdBy: 'bob',
  created: Date.now(),
  ...extra,
});

const ctx = () => server.boards.get('b1')!.ctx;
const rev = (kind: string, key: string) =>
  Number(ctx().storage.sql.exec('SELECT rev FROM records WHERE kind = ? AND key = ?', kind, key).toArray()[0]?.rev ?? 0);
const usage = () => JSON.parse(String(ctx().storage.sql.exec("SELECT v FROM kv WHERE k = 'usage'").toArray()[0].v));

async function put(userId: string, role: 'admin' | 'member', recs: { kind: string; key: string; data: unknown }[]) {
  const b = await server.board('b1');
  return (await b.httpSync(userId, role, { t: 'put', id: 1, recs: recs.map((r) => ({ ...r, base: rev(r.kind, r.key) })) })) as
    | { t: string; ok?: { key: string }[]; rejected?: { key: string }[] }[]
    | null;
}

/** A device's open connection, as the Worker hands it over. */
function socket(userId: string) {
  server.tokens.set(`t-${userId}`, userId);
  const got: string[] = [];
  const client = { deliver: (raw: string) => got.push(raw), closed: (code: number) => got.push(`closed ${code}`) };
  const conn = server.connect(client as never, 'b1', `t-${userId}`)!;
  return { ws: conn.ws, got };
}

beforeEach(async () => {
  server = startServer();
  await server.create('b1', member('ann', 'admin'));
  await server.join('b1', member('bob'));
  await put('ann', 'admin', [{ kind: 'column', key: 'c1', data: { id: 'c1', name: 'Todo', order: 1 } }]);
});

describe('who may talk to the board', () => {
  it("doesn't call someone removed whom the directory has in it", async () => {
    const b = await server.board('b1');
    server.directory('b1', 'zed', 'member');
    expect(await b.httpSync('zed', 'member', { t: 'hello', since: 0 })).toEqual([{ t: 'unlisted' }]);
    await b.setMember(member('zed'), null);
    expect((await b.httpSync('zed', 'member', { t: 'hello', since: 0 }))![0]).toMatchObject({ t: 'changes' });
  });

  it("answers someone not in its member list as removed, whatever the Worker says", async () => {
    const b = await server.board('b1');
    expect(await b.httpSync('zed', 'admin', { t: 'hello', since: 0 })).toEqual([{ t: 'removed' }]);
    expect(await put('zed', 'admin', [{ kind: 'card', key: 'k1', data: card('k1') }])).toEqual([{ t: 'removed' }]);
    expect(await server.records('b1', 'card')).toEqual([]);
  });

  it("never takes a role above the member record's", async () => {
    const res = await put('bob', 'admin', [{ kind: 'board', key: 'main', data: { name: 'Mine now', hue: 'rose', maxUploadMB: 30 } }]);
    expect(res![0].rejected).toHaveLength(1);
    expect((await server.records('b1', 'board'))[0].name).toBe('b1');
  });

  it("closes a removed person's connection at their next change, though the board wasn't told", async () => {
    const { ws, got } = socket('bob');
    // Taken out in the directory; the call to the board failed.
    server.directory('b1', 'bob', null);
    await (await server.board('b1')).webSocketMessage(ws as never, JSON.stringify({ t: 'put', id: 1, recs: [{ kind: 'card', key: 'k1', base: 0, data: card('k1') }] }));
    expect(got).toContain('closed 4003');
    expect(await server.records('b1', 'card')).toEqual([]);
  });
});

describe('a full board', () => {
  const fill = (rows: number, bytes: number) => {
    ctx().storage.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('usage', ?)", JSON.stringify({ rows, bytes }));
    (server.boards.get('b1')!.board as unknown as { usage: unknown }).usage = null;
  };

  it('counts every row it keeps, log entries included', async () => {
    const before = usage();
    await put('bob', 'member', [{ kind: 'card', key: 'k1', data: card('k1') }]);
    const after = usage();
    // The card and its "created" entry.
    expect(after.rows - before.rows).toBe(2);
    expect(after.bytes).toBeGreaterThan(before.bytes + JSON.stringify(card('k1')).length);
  });

  it('refuses what would make it bigger, one record at a time, and still takes the rest', async () => {
    await put('bob', 'member', [{ kind: 'card', key: 'k1', data: card('k1', { title: 'A long title for this card' }) }]);
    fill(10, 20 * 1024 * 1024);
    const res = await put('bob', 'member', [
      { kind: 'card', key: 'k2', data: card('k2') },
      { kind: 'card', key: 'k1', data: card('k1', { title: 'Short' }) },
    ]);
    expect(res![0].rejected!.map((r) => r.key)).toEqual(['k2']);
    expect(res![0].ok!.map((r) => r.key)).toEqual(['k1']);
  });

  it('refuses new records past the most it keeps', async () => {
    fill(100_000, 0);
    const res = await put('bob', 'member', [{ kind: 'card', key: 'k1', data: card('k1') }]);
    expect(res![0].rejected!.map((r) => r.key)).toEqual(['k1']);
  });

  it("forgets Elastic's op ids once no op that old is taken", async () => {
    await server.join('b1', member('bob'));
    ctx().storage.sql.exec('INSERT INTO ops (id, at) VALUES (?, ?)', 'old', Date.now() - 63 * 24 * 3600_000);
    await (await server.board('b1')).elasticOps('bob', []);
    expect(ctx().storage.sql.exec('SELECT id FROM ops').toArray()).toEqual([]);
  });
});

describe('too much too fast', () => {
  it('slows down one person sending change after change', async () => {
    let refused = 0;
    for (let i = 0; i < 250; i++) if ((await put('bob', 'member', [{ kind: 'card', key: `k${i}`, data: card(`k${i}`) }])) === null) refused++;
    expect(refused).toBe(10);
    // Someone else is unaffected.
    expect(await put('ann', 'admin', [{ kind: 'card', key: 'a1', data: card('a1') }])).not.toBeNull();
  });

  it("closes a connection that sends too fast; the device comes back after a pause", async () => {
    const { ws, got } = socket('bob');
    const b = await server.board('b1');
    for (let i = 0; i < 121; i++)
      await b.webSocketMessage(ws as never, JSON.stringify({ t: 'put', id: i, recs: [{ kind: 'card', key: `k${i}`, base: 0, data: card(`k${i}`) }] }));
    expect(got).toContain('closed 1013');
  });

  it("caps the updates one person's changes make in a minute", async () => {
    await server.idle();
    server.d1.db.exec('DELETE FROM notes');
    for (let i = 0; i < 40; i++) await put('ann', 'admin', [{ kind: 'card', key: `k${i}`, data: card(`k${i}`, { assignees: ['bob'], createdBy: 'ann' }) }]);
    await server.idle();
    const n = (server.d1.db.prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id = 'bob'").get() as { n: number }).n;
    expect(n).toBe(30);
    // The rest come as one line, a minute later.
    await (await server.board('b1')).alarm();
    await server.idle();
    const more = server.d1.db.prepare("SELECT data FROM notes WHERE user_id = 'bob' AND kind = 'more'").all() as { data: string }[];
    expect(more.map((m) => JSON.parse(m.data).to)).toEqual(['10']);
    await (await server.board('b1')).alarm();
    await server.idle();
    expect((server.d1.db.prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id = 'bob'").get() as { n: number }).n).toBe(31);
  });
});

describe('what Elastic reads', () => {
  it('knows when a card was completed without the log, old boards included', async () => {
    const b = await server.board('b1');
    await put('bob', 'member', [{ kind: 'card', key: 'k1', data: card('k1', { assignees: ['bob'], values: { end: '2026-12-01' } }) }]);
    await put('bob', 'member', [{ kind: 'card', key: 'k1', data: card('k1', { assignees: ['bob'], values: { end: '2026-12-01' }, done: { bob: Date.now() } }) }]);
    const [a] = await b.myCards('bob', 'https://x/');
    expect(a.completed && a.completedAt).toBeTruthy();
    // As a board from before: nothing kept yet, so its log is read, once.
    ctx().storage.sql.exec('DELETE FROM done_at');
    ctx().storage.sql.exec("DELETE FROM kv WHERE k = 'done_at'");
    expect((await b.myCards('bob', 'https://x/'))[0].completedAt).toBe(a.completedAt);
    ctx().storage.sql.exec("DELETE FROM records WHERE kind = 'log'");
    expect((await b.myCards('bob', 'https://x/'))[0].completedAt).toBe(a.completedAt);
  });

  it('keeps no more than a gigabyte of files', async () => {
    const b = await server.board('b1');
    await put('bob', 'member', [{ kind: 'card', key: 'k1', data: card('k1') }]);
    const f = (id: string, size: number) => ({ id, cardId: 'k1', name: 'a.pdf', mime: 'application/pdf', size, by: 'bob', at: 1, thumb: false });
    expect((await b.addFile('bob', f('f1', 1024 ** 3 - 10))).file).not.toBeNull();
    expect(await b.addFile('bob', f('f2', 20))).toEqual({ file: null, full: true });
  });
});

describe('a session that was ended', () => {
  const open = async (hash: string) => {
    const { ws, got } = socket('bob');
    ws.serializeAttachment({ userId: 'bob', role: 'member', session: hash });
    return { ws, got };
  };
  const session = (hash: string) =>
    server.d1.db.prepare('INSERT INTO sessions (hash, user_id, created, used) VALUES (?, ?, 1, 1)').run(hash, 'bob');

  it('can change nothing through a connection left open', async () => {
    const b = await server.board('b1');
    session('h1');
    const { ws, got } = await open('h1');
    const send = (key: string) => b.webSocketMessage(ws as never, JSON.stringify({ t: 'put', id: 1, recs: [{ kind: 'card', key, base: 0, data: card(key) }] }));
    await send('k1');
    server.d1.db.prepare('DELETE FROM sessions').run();
    await send('k2');
    expect(got.at(-1)).toBe('closed 4001');
    expect((await server.records('b1', 'card')).map((c: CardRec) => c.id)).toEqual(['k1']);
  });

  it('has its connections closed, and no others', async () => {
    const b = await server.board('b1');
    const gone = await open('h1');
    const kept = await open('h2');
    await b.dropSessions('bob', ['h1']);
    expect(gone.got).toContain('closed 4001');
    expect(kept.got).toEqual([]);
  });

  it('keeps the session on a connection when the role changes', async () => {
    const b = await server.board('b1');
    const { ws } = await open('h1');
    await b.setMember(member('bob', 'admin'), null);
    expect(ws.deserializeAttachment()).toMatchObject({ role: 'admin', session: 'h1' });
  });
});
