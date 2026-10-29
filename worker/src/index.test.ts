// The Worker's front door (index.ts): which pages may call it and what, and what a non-member
// gets from the board's sync. The directory is node:sqlite; boards are stand-ins.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeD1 } from '../../test/fake-d1';
import { newSession } from './auth';
import worker from './index';

let env: any;
let token: string;
/** What reached a board. */
let reached: string[];

const APP = 'https://boardo.kaiserkhan.com';
const OLD = 'https://kaiserkhan.com';

const call = (path: string, origin: string | null, body: unknown = {}, auth = token) =>
  worker.fetch(
    new Request(`${APP}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: JSON.stringify(body),
    }) as never,
    env,
    {} as never,
  );

beforeEach(async () => {
  const { db, d1 } = fakeD1();
  reached = [];
  const board = {
    httpSync: async () => (reached.push('httpSync'), [{ t: 'changes', recs: [], done: true }]),
    fetch: async () => (reached.push('fetch'), new Response(null)),
  };
  env = {
    DB: d1,
    ALLOWED_ORIGINS: APP,
    LEGACY_ORIGINS: `${OLD},https://www.kaiserkhan.com`,
    DEV_ORIGINS: 'http://localhost:5174',
    APP_URL: `${APP}/`,
    BOARDS: { idFromName: (n: string) => n, get: () => board },
  };
  db.exec(`INSERT INTO users (id, email, name, created) VALUES ('ann', 'ann@x.com', 'Ann', 1), ('bob', 'bob@x.com', 'Bob', 1)`);
  db.exec(`INSERT INTO boards (id, name, hue, created_by, created) VALUES ('b1', 'Launch', 'cyan', 'ann', 1)`);
  db.exec(`INSERT INTO members (board_id, user_id, role, added_at) VALUES ('b1', 'ann', 'admin', 1)`);
  token = await newSession(env, 'ann');
});

afterEach(() => vi.unstubAllGlobals());

describe('which pages may call the API', () => {
  it("takes the app's own address, and refuses any other", async () => {
    expect((await call('/boards', APP)).status).toBe(200);
    const res = await call('/boards', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect((await call('/boards', null)).status).toBe(403);
  });

  it('takes the old address only for what its farewell build needs', async () => {
    const ok = await call('/boards', OLD);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe(OLD);
    expect((await call('/account/handoff', OLD)).status).toBe(200);
    for (const path of ['/auth/passkey/login/start', '/auth/code/send', '/me/email/send', '/me/delete', '/oauth/approve', '/apps'])
      expect((await call(path, OLD)).status, path).toBe(403);
  });

  it('takes local copies of the app only when running locally', async () => {
    expect((await call('/boards', 'http://localhost:5174')).status).toBe(403);
    env.DEV_MAIL = '1';
    expect((await call('/boards', 'http://localhost:5174')).status).toBe(200);
  });

  it("answers a signed file link with a plain refusal when files aren't set up", async () => {
    const res = await worker.fetch(new Request(`${APP}/api/files/b1/f1?exp=${Date.now() + 1000}&sig=x`) as never, env, {} as never);
    expect(res.status).toBe(503);
  });
});

describe("a board's sync, for someone not in it", () => {
  it('says removed over requests, and never reaches the board', async () => {
    const t = await newSession(env, 'bob');
    const res = await call('/sync/http', APP, { board: 'b1', m: { t: 'hello', since: 0 } }, t);
    expect(await res.json()).toEqual({ msgs: [{ t: 'removed' }] });
    expect(reached).toEqual([]);
    expect(await (await call('/sync/http', APP, { board: 'b1', m: { t: 'hello', since: 0 } })).json()).toMatchObject({ msgs: [{ t: 'changes' }] });
  });

  it('says removed on a socket and closes it, and never reaches the board', async () => {
    const sent: string[] = [];
    let closed = 0;
    const end = () => ({ accept() {}, send: (m: string) => sent.push(m), close: (code: number) => (closed = code) });
    vi.stubGlobal('WebSocketPair', class { 0 = end(); 1 = end(); });
    // Node's Response has no 101; the Workers runtime does.
    const Real = Response;
    vi.stubGlobal('Response', class extends Real {
      constructor(body: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
        super(body, init?.status === 101 ? { ...init, status: 200 } : init);
      }
    });
    const t = await newSession(env, 'bob');
    const req = new Request(`${APP}/api/sync?board=b1`, { headers: { upgrade: 'websocket', origin: APP, 'sec-websocket-protocol': `boardo, ${t}` } });
    await worker.fetch(req as never, env, {} as never);
    expect(sent).toEqual([JSON.stringify({ t: 'removed' })]);
    expect(closed).toBe(4003);
    expect(reached).toEqual([]);
    // A member is handed over.
    const mine = new Request(`${APP}/api/sync?board=b1`, { headers: { upgrade: 'websocket', origin: APP, 'sec-websocket-protocol': `boardo, ${token}` } });
    await worker.fetch(mine as never, env, {} as never);
    expect(reached).toEqual(['fetch']);
  });
});
