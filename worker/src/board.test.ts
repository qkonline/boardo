// Deleting an archived card, against the real Board Durable Object.
import { beforeEach, describe, expect, it } from 'vitest';
import type { CardRec, LogRec } from '../../shared/model';
import { member, startServer, type FakeServer } from '../../test/fake-board';

let server: FakeServer;

function put(kind: string, key: string, data: unknown) {
  const ctx = server.boards.get('b1')!.ctx;
  const rev = Number(ctx.storage.sql.exec("SELECT v FROM kv WHERE k = 'rev'").toArray()[0].v) + 1;
  ctx.storage.sql.exec('INSERT OR REPLACE INTO records (kind, key, rev, data) VALUES (?, ?, ?, ?)', kind, key, rev, JSON.stringify(data));
  ctx.storage.sql.exec("UPDATE kv SET v = ? WHERE k = 'rev'", String(rev));
}

const card = (archived: boolean, createdBy = 'bob'): CardRec => ({
  id: 'k1',
  columnId: 'c1',
  order: 1,
  title: 'Old idea',
  desc: '',
  values: {},
  assignees: [],
  done: {},
  archived,
  createdBy,
  created: 0,
});

beforeEach(async () => {
  server = startServer();
  await server.create('b1', member('ann', 'admin'));
  await server.join('b1', member('bob'));
  await server.join('b1', member('cy'));
});

describe('deleting an archived card', () => {
  it('takes the card, its comments, files and time, and keeps its log', async () => {
    put('card', 'k1', card(true));
    put('comment', 'm1', { id: 'm1', cardId: 'k1', userId: 'bob', text: 'hi', at: 1 });
    put('file', 'f1', { id: 'f1', cardId: 'k1', name: 'a.pdf', mime: 'application/pdf', size: 9, by: 'bob', at: 1, thumb: false });
    put('session', 's1', { id: 's1', cardId: 'k1', userId: 'bob', start: 1, end: 2 });
    put('log', 'l1', { id: 'l1', cardId: 'k1', userId: 'bob', at: 1, action: 'created', detail: {} });
    const res = await (await server.board('b1')).deleteCard('ann', 'admin', 'k1');
    expect(res).toEqual({ keys: ['b1/f1', 'b1/f1.thumb'] });
    for (const k of ['card', 'comment', 'file', 'session']) expect(await server.records('b1', k)).toEqual([]);
    const logs = (await server.records('b1', 'log')) as LogRec[];
    expect(logs.map((l) => l.action).sort()).toContain('created');
    expect(logs.find((l) => l.action === 'deleted')).toMatchObject({ userId: 'ann', detail: { title: 'Old idea' } });
  });
  it('lets whoever made it delete it, but not other members', async () => {
    put('card', 'k1', card(true, 'bob'));
    const b = await server.board('b1');
    expect(await b.deleteCard('cy', 'member', 'k1')).toBe('denied');
    expect(await b.deleteCard('bob', 'member', 'k1')).toEqual({ keys: [] });
  });
  it('refuses a card that is not archived', async () => {
    put('card', 'k1', card(false));
    expect(await (await server.board('b1')).deleteCard('ann', 'admin', 'k1')).toBe('live');
    expect(await server.records('b1', 'card')).toHaveLength(1);
  });
});
