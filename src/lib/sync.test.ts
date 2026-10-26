// Several people, each with their own device (own IndexedDB, own copy of every module), syncing
// through the real Board Durable Object over fake WebSockets (test/fake-board.ts).

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardRec, FieldRec, LogRec } from '../../shared/model';
import { member, startServer, type FakeServer } from '../../test/fake-board';

interface Device {
  user: string;
  db: typeof import('./db');
  sync: import('./sync').Sync;
  removed: string[];
  signedOut: boolean;
  refused: number;
}

let server: FakeServer;
const devices: Device[] = [];

async function device(user: string, boards: string[]): Promise<Device> {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  const db = await import('./db');
  const { Sync } = await import('./sync');
  server.tokens.set(`t-${user}`, user);
  const d: Device = { user, db, sync: null!, removed: [], signedOut: false, refused: 0 };
  d.sync = new Sync('http://api.test', {
    changed: () => {},
    status: () => {},
    signedOut: () => (d.signedOut = true),
    removed: (b) => d.removed.push(b),
    refused: (_, n) => (d.refused += n),
    noted: () => {},
  });
  d.sync.start(`t-${user}`, boards);
  devices.push(d);
  await settle();
  return d;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 0));
    for (const d of devices) await d.sync.settled();
  }
}

const card = (id: string, by: string, extra: Partial<CardRec> = {}): CardRec => ({
  id,
  columnId: 'c1',
  order: 1,
  title: id,
  desc: '',
  values: { status: 'not' },
  assignees: [],
  done: {},
  archived: false,
  createdBy: by,
  created: Date.now(),
  ...extra,
});

async function put(d: Device, board: string, kind: 'card' | 'column' | 'field' | 'comment' | 'board', key: string, data: unknown) {
  await d.db.putLocal([{ board, kind, key, data }]);
  d.sync.kick(board);
  await settle();
}

const local = async <T>(d: Device, board: string, kind: string, key: string) =>
  (await d.db.getRecord(`${board}/${kind}/${key}`)) as T | null;

beforeEach(async () => {
  server = startServer();
  globalThis.IDBKeyRange = IDBKeyRange;
  // People in one process mustn't hear each other's tab messages.
  vi.stubGlobal('BroadcastChannel', undefined);
  // Nor share one tab lock (Node has navigator.locks): each device leads its own sync.
  vi.stubGlobal('navigator', { locks: undefined });
  await server.create('b1', member('ann', 'admin'));
  await server.join('b1', member('bob'));
  await put0();
});

/** A column to put cards in, straight on the board. */
async function put0() {
  const b = await server.board('b1');
  const ctx = server.boards.get('b1')!.ctx;
  void b;
  ctx.storage.sql.exec(
    "INSERT INTO records (kind, key, rev, data) VALUES ('column', 'c1', 1000, ?)",
    JSON.stringify({ id: 'c1', name: 'Campaign 1', order: 1 }),
  );
  ctx.storage.sql.exec("UPDATE kv SET v = '1000' WHERE k = 'rev'");
}

afterEach(() => {
  devices.splice(0).forEach((d) => d.sync.stop());
  vi.unstubAllGlobals();
});

describe('sync between people', () => {
  it('sends changes both ways and keeps the board as the record', async () => {
    const ann = await device('ann', ['b1']);
    const bob = await device('bob', ['b1']);
    expect(await local(bob, 'b1', 'column', 'c1')).toMatchObject({ name: 'Campaign 1' });
    await put(ann, 'b1', 'card', 'k1', card('k1', 'ann'));
    expect(await local<CardRec>(bob, 'b1', 'card', 'k1')).toMatchObject({ title: 'k1', createdBy: 'ann' });
    await put(bob, 'b1', 'card', 'k1', { ...card('k1', 'ann'), title: 'Write the launch email' });
    expect((await local<CardRec>(ann, 'b1', 'card', 'k1'))!.title).toBe('Write the launch email');
    expect(await ann.db.getOutbox()).toEqual([]);
  });

  it('merges offline edits to different fields of one card', async () => {
    const ann = await device('ann', ['b1']);
    const bob = await device('bob', ['b1']);
    await put(ann, 'b1', 'card', 'k1', card('k1', 'ann'));
    // Both change the card at once: Ann the title, Bob the dates and status.
    server.held = [];
    await put(ann, 'b1', 'card', 'k1', { ...card('k1', 'ann'), title: 'New title' });
    await put(bob, 'b1', 'card', 'k1', { ...card('k1', 'ann'), values: { status: 'prog', start: '2026-10-24' } });
    const held = server.held;
    server.held = null;
    held.forEach((go) => go());
    await settle();
    for (const d of [ann, bob]) {
      const c = (await local<CardRec>(d, 'b1', 'card', 'k1'))!;
      expect(c.title).toBe('New title');
      expect(c.values).toEqual({ status: 'prog', start: '2026-10-24' });
    }
  });

  it('never gives a board to someone who is not in it', async () => {
    const eve = await device('eve', ['b1']);
    expect(eve.removed).toEqual(['b1']);
    expect(await eve.db.getRecords('b1')).toEqual([]);
  });

  it('wipes the board from the device of someone removed', async () => {
    const bob = await device('bob', ['b1']);
    expect((await bob.db.getRecords('b1')).length).toBeGreaterThan(0);
    await server.remove('b1', 'bob');
    await settle();
    expect(bob.removed).toEqual(['b1']);
    expect(await bob.db.getRecords('b1')).toEqual([]);
  });

  it('refuses fields from a member and puts the board version back', async () => {
    const bob = await device('bob', ['b1']);
    const status = (await local<FieldRec>(bob, 'b1', 'field', 'status'))!;
    await put(bob, 'b1', 'field', 'status', { ...status, name: 'Mine now' });
    expect((await local<FieldRec>(bob, 'b1', 'field', 'status'))!.name).toBe('Status');
    expect(await bob.db.getOutbox()).toEqual([]);
    // Bob is told, and his version is kept aside.
    expect(bob.refused).toBe(1);
    expect(await bob.db.getRefused('b1')).toMatchObject([{ id: 'b1/field/status', data: { name: 'Mine now' } }]);
    const ann = await device('ann', ['b1']);
    await put(ann, 'b1', 'field', 'status', { ...status, name: 'State' });
    expect((await local<FieldRec>(bob, 'b1', 'field', 'status'))!.name).toBe('State');
  });

  it('completes a card when every part is done, and logs it as automatic', async () => {
    const ann = await device('ann', ['b1']);
    const bob = await device('bob', ['b1']);
    await put(ann, 'b1', 'card', 'k1', card('k1', 'ann', { assignees: ['ann', 'bob'], values: { status: 'prog' } }));
    const mine = (await local<CardRec>(ann, 'b1', 'card', 'k1'))!;
    await put(ann, 'b1', 'card', 'k1', { ...mine, done: { ann: Date.now() } });
    expect((await local<CardRec>(bob, 'b1', 'card', 'k1'))!.values.status).toBe('prog');
    const theirs = (await local<CardRec>(bob, 'b1', 'card', 'k1'))!;
    // Bob also tries to tick Ann's part off again: only his own counts.
    await put(bob, 'b1', 'card', 'k1', { ...theirs, done: { bob: Date.now() } });
    for (const d of [ann, bob]) {
      const c = (await local<CardRec>(d, 'b1', 'card', 'k1'))!;
      expect(c.values.status).toBe('done');
      expect(Object.keys(c.done).sort()).toEqual(['ann', 'bob']);
    }
    const logs = (await server.records('b1', 'log')) as LogRec[];
    expect(logs.find((l) => l.action === 'status')).toMatchObject({ userId: null, detail: { auto: true, to: 'Completed' } });
    expect(logs.filter((l) => l.action === 'part_done').map((l) => l.userId).sort()).toEqual(['ann', 'bob']);
    // The log reached both devices too.
    expect((await bob.db.getRecords('b1')).filter((r) => r.kind === 'log').length).toBe(logs.length);
  });

  it('refuses only the record that is wrong, not the rest sent with it', async () => {
    const ann = await device('ann', ['b1']);
    await ann.db.putLocal([
      { board: 'b1', kind: 'card', key: 'k1', data: card('k1', 'ann') },
      { board: 'b1', kind: 'card', key: 'k2', data: { ...card('k2', 'ann'), title: 7 } },
    ]);
    ann.sync.kick('b1');
    await settle();
    expect(((await server.records('b1', 'card')) as CardRec[]).map((c) => c.id)).toEqual(['k1']);
    expect(await local(ann, 'b1', 'card', 'k1')).not.toBeNull();
    expect(await local(ann, 'b1', 'card', 'k2')).toBeNull();
    expect(ann.refused).toBe(1);
  });

  it('refuses a comment on a card that is gone, but takes one on a card sent with it', async () => {
    const ann = await device('ann', ['b1']);
    const c = { id: 'm1', cardId: 'k9', userId: 'ann', text: 'Hello', at: Date.now() };
    await put(ann, 'b1', 'comment', 'm1', c);
    expect(await server.records('b1', 'comment')).toEqual([]);
    expect(ann.refused).toBe(1);
    // The comment ahead of its card in one put.
    await ann.db.putLocal([
      { board: 'b1', kind: 'comment', key: 'm2', data: { ...c, id: 'm2', cardId: 'k2' } },
      { board: 'b1', kind: 'card', key: 'k2', data: card('k2', 'ann') },
    ]);
    ann.sync.kick('b1');
    await settle();
    expect(((await server.records('b1', 'comment')) as { id: string }[]).map((x) => x.id)).toEqual(['m2']);
  });

  it('moves a card added offline to a column removed meanwhile into the first column', async () => {
    const ann = await device('ann', ['b1']);
    const bob = await device('bob', ['b1']);
    await put(ann, 'b1', 'column', 'c0', { id: 'c0', name: 'First', order: 0 });
    await put(ann, 'b1', 'column', 'c2', { id: 'c2', name: 'Doomed', order: 5 });
    // Bob, offline, adds a card to Doomed while Ann removes it.
    bob.sync.stop();
    await bob.db.putLocal([{ board: 'b1', kind: 'card', key: 'k1', data: card('k1', 'bob', { columnId: 'c2' }) }]);
    await put(ann, 'b1', 'column', 'c2', null);
    bob.sync.start('t-bob', ['b1']);
    await settle();
    for (const d of [ann, bob]) expect((await local<CardRec>(d, 'b1', 'card', 'k1'))!.columnId).toBe('c0');
    expect(bob.refused).toBe(0);
  });

  it("lets only a comment's author change it", async () => {
    const ann = await device('ann', ['b1']);
    const bob = await device('bob', ['b1']);
    await put(ann, 'b1', 'card', 'k1', card('k1', 'ann'));
    const c = { id: 'm1', cardId: 'k1', userId: 'ann', text: 'Subject line is in the doc 👍', at: Date.now() };
    await put(ann, 'b1', 'comment', 'm1', c);
    await put(bob, 'b1', 'comment', 'm1', { ...c, text: 'Changed by Bob' });
    expect((await local<{ text: string }>(bob, 'b1', 'comment', 'm1'))!.text).toBe('Subject line is in the doc 👍');
    await put(bob, 'b1', 'comment', 'm2', { ...c, id: 'm2', text: 'As Ann' });
    expect(await local(bob, 'b1', 'comment', 'm2')).toBeNull();
  });

  it('signs out a device whose token is refused', async () => {
    server.tokens.clear();
    vi.resetModules();
    globalThis.indexedDB = new IDBFactory();
    const db = await import('./db');
    const { Sync } = await import('./sync');
    let out = false;
    const s = new Sync('http://api.test', { changed() {}, status() {}, signedOut: () => (out = true), removed() {}, refused() {}, noted() {} });
    s.start('nope', ['b1']);
    devices.push({ user: 'x', db, sync: s, removed: [], signedOut: false });
    await settle();
    expect(out).toBe(true);
  });

  it('never asks for the tab lock again at once when a page on its way out loses it', async () => {
    // As on iPhone during a reload: the lock held is taken away, and every new request is
    // refused straight away. Asking again at once looped for ever (capped here at 1000).
    let asked = 0;
    let takeAway = (_e: Error) => {};
    const locks = {
      request: (_name: string, _opts: object, cb: () => Promise<void>) => {
        if (++asked === 1)
          return new Promise<void>((_ok, fail) => {
            takeAway = fail;
            void cb();
          });
        return asked > 1000 ? new Promise<void>(() => {}) : Promise.reject(new Error('InvalidStateError'));
      },
    };
    vi.stubGlobal('navigator', { locks });
    await device('ann', ['b1']);
    expect(asked).toBe(1);

    takeAway(new Error('AbortError'));
    await settle();
    expect(asked).toBe(1);
    // A second later it asks again, once, and is refused again: still no loop.
    await new Promise((r) => setTimeout(r, 1100));
    await settle();
    expect(asked).toBe(2);
  });
});
