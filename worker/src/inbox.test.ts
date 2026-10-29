// The bell: updates made by the real Board DO as people change things, kept in D1 (inbox.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import type { CardRec } from '../../shared/model';
import { member, startServer, type FakeServer } from '../../test/fake-board';
import { listNotes, readNotes, seenNotes, subscribe, subscribed, unsubscribe } from './inbox';

let server: FakeServer;
let env: any;

const card = (extra: Partial<CardRec> = {}): CardRec => ({
  id: 'k1',
  columnId: 'c1',
  order: 1,
  title: 'Write the email',
  desc: '',
  values: {},
  assignees: [],
  done: {},
  archived: false,
  createdBy: 'ann',
  created: Date.now(),
  ...extra,
});

/** Send records as a person's device would. */
async function put(userId: string, role: 'admin' | 'member', recs: { kind: string; key: string; data: unknown }[]) {
  const b = await server.board('b1');
  const ctx = server.boards.get('b1')!.ctx;
  const base = (kind: string, key: string) =>
    Number(ctx.storage.sql.exec('SELECT rev FROM records WHERE kind = ? AND key = ?', kind, key).toArray()[0]?.rev ?? 0);
  await b.httpSync(userId, role, { t: 'put', id: 1, recs: recs.map((r) => ({ ...r, base: base(r.kind, r.key) })) });
  await server.idle();
}

beforeEach(async () => {
  server = startServer();
  env = { DB: server.d1.d1 };
  server.d1.db.exec(`INSERT INTO users (id, email, name, created) VALUES ('ann', 'ann@x.com', 'ANN', 1), ('bob', 'bob@x.com', 'BOB', 1)`);
  await server.create('b1', member('ann', 'admin'));
  await server.join('b1', member('bob'));
  await server.idle();
  server.d1.db.exec('DELETE FROM notes');
  const ctx = server.boards.get('b1')!.ctx;
  ctx.storage.sql.exec("INSERT INTO records (kind, key, rev, data) VALUES ('column', 'c1', 1000, ?)", JSON.stringify({ id: 'c1', name: 'Todo', order: 1 }));
  ctx.storage.sql.exec("UPDATE kv SET v = '1000' WHERE k = 'rev'");
});

describe('the bell', () => {
  it('gets an update when someone is put on a card, and a red count until the bell is opened', async () => {
    await put('ann', 'admin', [{ kind: 'card', key: 'k1', data: card({ assignees: ['bob'] }) }]);
    const { notes, unseen } = await listNotes(env, 'bob');
    expect(notes).toMatchObject([{ kind: 'assigned', board: 'b1', card: 'k1', title: 'Write the email', boardName: 'b1', by: { userId: 'ann', name: 'ANN' }, read: false }]);
    expect(unseen).toBe(1);
    expect((await listNotes(env, 'ann')).notes).toEqual([]);
    await seenNotes(env, 'bob');
    expect((await listNotes(env, 'bob')).unseen).toBe(0);
    expect((await listNotes(env, 'bob')).notes[0].read).toBe(false);
  });

  it('gets a mention from a comment, quoted, and the card maker gets the comment', async () => {
    await put('ann', 'admin', [{ kind: 'card', key: 'k1', data: card() }]);
    await put('bob', 'member', [{ kind: 'comment', key: 'm1', data: { id: 'm1', cardId: 'k1', userId: 'bob', text: 'Looks good @ANN', at: Date.now() } }]);
    const { notes } = await listNotes(env, 'ann');
    expect(notes).toMatchObject([{ kind: 'mention', quote: 'Looks good @ANN', by: { name: 'BOB' } }]);
  });

  it('marks some or all read', async () => {
    await put('ann', 'admin', [{ kind: 'card', key: 'k1', data: card({ assignees: ['bob'] }) }]);
    await put('ann', 'admin', [{ kind: 'card', key: 'k1', data: card({ assignees: ['bob'], values: { end: '2026-11-02' } }) }]);
    const { notes } = await listNotes(env, 'bob');
    expect(notes.map((n) => n.kind)).toEqual(['due', 'assigned']);
    await readNotes(env, 'bob', { ids: [notes[0].id] });
    expect((await listNotes(env, 'bob')).notes.map((n) => n.read)).toEqual([true, false]);
    await readNotes(env, 'bob', {});
    expect((await listNotes(env, 'bob')).notes.every((n) => n.read)).toBe(true);
    expect((await listNotes(env, 'bob')).unseen).toBe(0);
  });

  it('tells someone their role changed, or that they were taken out', async () => {
    await (await server.board('b1')).setMember({ ...member('bob'), role: 'admin' }, 'ann');
    await (await server.board('b1')).removeMember('bob', 'ann');
    await server.idle();
    expect((await listNotes(env, 'bob')).notes.map((n) => `${n.kind}:${n.to ?? ''}`)).toEqual(['removed:', 'role:admin']);
  });

  it("tells the person's open devices on this board to fetch", async () => {
    const sent: string[] = [];
    const ctx = server.boards.get('b1')!.ctx as any;
    ctx.sockets.push({ open: true, tags: ['bob'], send: (m: string) => sent.push(m), close() {}, serializeAttachment() {}, deserializeAttachment: () => ({ userId: 'bob', role: 'member' }) });
    await put('ann', 'admin', [{ kind: 'card', key: 'k1', data: card({ assignees: ['bob'] }) }]);
    expect(sent).toContain('{"t":"note"}');
  });
});

describe('alerts', () => {
  it('takes only real push services, one person per browser', async () => {
    expect(await subscribe(env, 'bob', { endpoint: 'https://evil.example.com/x' })).toBe(false);
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    expect(await subscribe(env, 'bob', { endpoint })).toBe(true);
    expect(await subscribed(env, 'bob', { endpoint })).toBe(true);
    await subscribe(env, 'ann', { endpoint });
    expect(await subscribed(env, 'bob', { endpoint })).toBe(false);
    await unsubscribe(env, 'ann', { endpoint });
    expect(await subscribed(env, 'ann', { endpoint })).toBe(false);
  });

  it('keeps ten browsers per person at most, the newest', async () => {
    for (let i = 0; i < 12; i++) {
      server.d1.db.prepare('UPDATE push_subs SET created = created - 1000').run();
      await subscribe(env, 'bob', { endpoint: `https://fcm.googleapis.com/fcm/send/${i}` });
    }
    const kept = server.d1.db.prepare("SELECT endpoint FROM push_subs WHERE user_id = 'bob'").all().map((r) => String(r.endpoint).split('/').pop());
    expect(kept.sort((a, b) => Number(a) - Number(b))).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
  });
});
