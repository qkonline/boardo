// Runs the real Board Durable Object (worker/src/board.ts) in Node: its SQL storage on
// node:sqlite, its WebSockets as fakes that deliver asynchronously, and a stand-in for the
// Worker's membership check in front of it. Devices in tests connect through `FakeSocket`,
// stubbed in as the global WebSocket.

import { DatabaseSync } from 'node:sqlite';
import { vi } from 'vitest';
import { fakeD1 } from './fake-d1';
import type { MemberRec, Role } from '../shared/model';

type Row = Record<string, unknown>;

function cursor(rows: Row[]) {
  return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
}

function sqlStorage(db: DatabaseSync) {
  return {
    exec(query: string, ...b: unknown[]) {
      if (!b.length && query.split(';').filter((s) => s.trim()).length > 1) {
        db.exec(query);
        return cursor([]);
      }
      const st = db.prepare(query);
      if (/^\s*(select|with)\b/i.test(query) || /\breturning\b/i.test(query))
        return cursor(st.all(...(b as never[])).map((r) => ({ ...r })));
      st.run(...(b as never[]));
      return cursor([]);
    },
  };
}

/** The board's side of a connection. */
class ServerSocket {
  att: unknown = null;
  open = true;
  constructor(
    readonly client: FakeSocket,
    readonly tags: string[],
  ) {}
  serializeAttachment(a: unknown) {
    this.att = structuredClone(a);
  }
  deserializeAttachment() {
    return structuredClone(this.att);
  }
  send(raw: string) {
    if (this.open) this.client.deliver(raw);
  }
  close(code = 1000) {
    if (!this.open) return;
    this.open = false;
    this.client.closed(code);
  }
}

class FakeCtx {
  constructor(private waits: Promise<unknown>[]) {}
  db = new DatabaseSync(':memory:');
  sockets: ServerSocket[] = [];
  storage = {
    sql: sqlStorage(this.db),
    transactionSync: <T>(fn: () => T): T => {
      this.db.exec('BEGIN');
      try {
        const r = fn();
        this.db.exec('COMMIT');
        return r;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    },
    deleteAll: async () => {
      for (const t of ['records', 'kv', 'ops']) this.db.exec(`DELETE FROM ${t}`);
    },
    deleteAlarm: async () => {},
    setAlarm: async () => {},
  };
  acceptWebSocket(ws: ServerSocket) {
    this.sockets.push(ws);
  }
  getWebSockets(tag?: string) {
    return this.sockets.filter((s) => s.open && (!tag || s.tags.includes(tag)));
  }
  setWebSocketAutoResponse() {}
  waitUntil(p: Promise<unknown>) {
    this.waits.push(p);
  }
}

export class FakeServer {
  boards = new Map<string, { board: any; ctx: FakeCtx }>();
  /** token → user id */
  tokens = new Map<string, string>();
  /** board → user → role */
  roles = new Map<string, Map<string, Role>>();
  /** While set, messages from devices wait (to make two people change things at once). */
  held: (() => void)[] | null = null;
  /** The directory (D1), where the boards also keep the bell's updates. */
  d1 = fakeD1();
  /** Work the boards carried on with after answering (storing updates). */
  waits: Promise<unknown>[] = [];

  /** Wait for that work. */
  async idle() {
    while (this.waits.length) await Promise.all(this.waits.splice(0));
  }

  async board(id: string) {
    let b = this.boards.get(id);
    if (!b) {
      const { Board } = await import('../worker/src/board');
      const ctx = new FakeCtx(this.waits);
      const env = { DB: this.d1.d1 };
      b = { board: new Board(ctx as never, env as never), ctx };
      this.boards.set(id, b);
    }
    return b.board as import('../worker/src/board').Board;
  }

  /** A new board with its first admin, as the Worker makes it. */
  async create(id: string, admin: MemberRec) {
    const b = await this.board(id);
    await b.init(id, { name: id, hue: 'cyan', maxUploadMB: 30 }, admin);
    this.roles.set(id, new Map([[admin.userId, 'admin']]));
    return b;
  }

  async join(id: string, m: MemberRec) {
    this.roles.get(id)!.set(m.userId, m.role);
    await (await this.board(id)).setMember(m, null);
  }

  async remove(id: string, userId: string) {
    this.roles.get(id)!.delete(userId);
    await (await this.board(id)).removeMember(userId, null);
  }

  /** What the Worker's /sync does: check the token and membership, then hand over. */
  connect(client: FakeSocket, board: string, token: string) {
    const user = this.tokens.get(token);
    const role = user ? this.roles.get(board)?.get(user) : null;
    const b = this.boards.get(board);
    if (!user || !role || !b) {
      client.deliver(JSON.stringify({ t: user ? 'removed' : 'signedout' }));
      setTimeout(() => client.closed(user ? 4003 : 4001));
      return null;
    }
    const ws = new ServerSocket(client, [user]);
    ws.serializeAttachment({ userId: user, role });
    b.ctx.acceptWebSocket(ws);
    return { ws, board: b.board };
  }

  async records(board: string, kind: string) {
    const b = this.boards.get(board)!;
    return b.ctx.storage.sql
      .exec(`SELECT data FROM records WHERE kind = ? AND data IS NOT NULL`, kind)
      .toArray()
      .map((r) => JSON.parse(r.data as string));
  }
}

export let server: FakeServer;

export class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  private conn: { ws: ServerSocket; board: any } | null = null;
  constructor(url: string, protocols: string[]) {
    const board = new URL(url).searchParams.get('board')!;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      this.conn = server.connect(this, board, protocols[1]);
    });
  }
  send(raw: string): void {
    if (raw === 'ping') return this.deliver('pong');
    const go = () => {
      if (this.conn?.ws.open) void this.conn.board.webSocketMessage(this.conn.ws, raw);
    };
    if (server.held) server.held.push(go);
    else setTimeout(go);
  }
  deliver(raw: string): void {
    setTimeout(() => this.readyState === 1 && this.onmessage?.({ data: raw }));
  }
  closed(code: number): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.onclose?.({ code }));
  }
  close(): void {
    this.readyState = 3;
    this.conn?.ws.close(1000);
  }
}

export function startServer(): FakeServer {
  server = new FakeServer();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('WebSocketRequestResponsePair', class {});
  return server;
}

export const member = (userId: string, role: Role = 'member'): MemberRec => ({
  userId,
  name: userId.toUpperCase(),
  email: `${userId}@example.com`,
  hue: 'indigo',
  role,
});
