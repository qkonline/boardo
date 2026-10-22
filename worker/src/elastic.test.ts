// Elastic's ops and card list, against the real Board Durable Object.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardRec, LogRec, SessionRec } from '../../shared/model';
import { member, startServer, type FakeServer } from '../../test/fake-board';

let server: FakeServer;
const T0 = Date.UTC(2026, 9, 22, 9, 0);

function put(b: string, kind: string, key: string, data: unknown) {
  const ctx = server.boards.get(b)!.ctx;
  const rev = Number(ctx.storage.sql.exec("SELECT v FROM kv WHERE k = 'rev'").toArray()[0].v) + 1;
  ctx.storage.sql.exec('INSERT OR REPLACE INTO records (kind, key, rev, data) VALUES (?, ?, ?, ?)', kind, key, rev, JSON.stringify(data));
  ctx.storage.sql.exec("UPDATE kv SET v = ? WHERE k = 'rev'", String(rev));
}

const card = (id: string, extra: Partial<CardRec> = {}): CardRec => ({
  id,
  columnId: 'c1',
  order: 1,
  title: id,
  desc: '',
  values: { status: 'not', start: '2026-10-21', end: '2026-10-23' },
  assignees: ['ann', 'bob'],
  done: {},
  archived: false,
  createdBy: 'ann',
  created: T0,
  ...extra,
});

const op = (id: string, type: string, at: number, cardId = 'k1') => ({ id, type, board: 'b1', cardId, sessionId: 's1', at }) as never;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0 + 3 * 3600_000);
  server = startServer();
  await server.create('b1', member('ann', 'admin'));
  await server.join('b1', member('bob'));
  put('b1', 'card', 'k1', card('k1'));
  put('b1', 'card', 'k2', card('k2', { assignees: ['bob'] }));
  put('b1', 'card', 'k3', card('k3', { values: { status: 'not' } }));
  put('b1', 'card', 'k4', card('k4', { archived: true }));
});

describe('Elastic', () => {
  it("lists only the person's dated, unarchived cards, with only the contract's fields", async () => {
    const b = await server.board('b1');
    const cards = await b.myCards('ann', 'https://kaiserkhan.com/boardo/');
    expect(cards.map((c) => c.id)).toEqual(['k1']);
    expect(Object.keys(cards[0]).sort()).toEqual(
      ['board', 'completed', 'completedAt', 'end', 'hasTime', 'id', 'myDone', 'start', 'status', 'title', 'url'].sort(),
    );
    expect(cards[0]).toMatchObject({
      board: { id: 'b1', name: 'b1', hue: 'cyan' },
      status: { label: 'Not started', role: null },
      url: 'https://kaiserkhan.com/boardo/?card=b1/k1',
      completed: false,
    });
  });

  it('start sets In progress and opens a session; stop logs the time worked at when it happened', async () => {
    const b = await server.board('b1');
    await b.elasticOps('ann', [op('o1', 'start', T0), op('o2', 'stop', T0 + 80 * 60_000)]);
    const [s] = (await server.records('b1', 'session')) as SessionRec[];
    expect(s).toMatchObject({ cardId: 'k1', userId: 'ann', start: T0, end: T0 + 80 * 60_000 });
    const c = ((await server.records('b1', 'card')) as CardRec[]).find((x) => x.id === 'k1')!;
    expect(c.values.status).toBe('prog');
    const logs = (await server.records('b1', 'log')) as LogRec[];
    expect(logs.find((l) => l.action === 'worked')).toMatchObject({ userId: 'ann', at: T0 + 80 * 60_000, detail: { ms: 80 * 60_000 } });
    expect(logs.find((l) => l.action === 'status')).toMatchObject({ userId: 'ann', at: T0, detail: { to: 'In progress', via: 'elastic' } });
  });

  it('counts each op once, however often it is sent', async () => {
    const b = await server.board('b1');
    await b.elasticOps('ann', [op('o1', 'start', T0), op('o2', 'stop', T0 + 60_000)]);
    await b.elasticOps('ann', [op('o1', 'start', T0), op('o2', 'stop', T0 + 60_000)]);
    expect(((await server.records('b1', 'log')) as LogRec[]).filter((l) => l.action === 'worked')).toHaveLength(1);
    expect(await server.records('b1', 'session')).toHaveLength(1);
  });

  it("done marks the person's part, and the last part completes the card", async () => {
    const b = await server.board('b1');
    await b.elasticOps('ann', [op('o1', 'done', T0)]);
    let c = ((await server.records('b1', 'card')) as CardRec[]).find((x) => x.id === 'k1')!;
    expect(c.done).toEqual({ ann: T0 });
    expect(c.values.status).toBe('not');
    await b.elasticOps('bob', [op('o2', 'done', T0 + 1000)]);
    c = ((await server.records('b1', 'card')) as CardRec[]).find((x) => x.id === 'k1')!;
    expect(c.values.status).toBe('done');
    const [mine] = await b.myCards('ann', 'https://x/');
    expect(mine).toMatchObject({ completed: true, completedAt: T0 + 1000, myDone: T0 });
  });

  it('refuses ops on cards the person is not assigned to', async () => {
    const b = await server.board('b1');
    const r = await b.elasticOps('ann', [op('o1', 'start', T0, 'k2')]);
    expect(r).toEqual([{ id: 'o1', ok: false, error: 'not-assigned' }]);
    expect(await server.records('b1', 'session')).toHaveLength(0);
  });
});
