// Elastic's link (link.ts): one per Elastic account, made by email or through the connect page,
// and the older per-device tokens handed over to it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeD1 } from '../../test/fake-d1';
import { adopt, ElasticLink, exchange, linkByEmail, lookup } from './link';
import { notifyElastic } from './notify';
import { deleteUser } from './auth';
import { appUser, approve, listApps, revokeApp, token } from './oauth';

let db: ReturnType<typeof fakeD1>['db'];
let env: any;
const ELASTIC = 'https://elastic.kaiserkhan.com/';
const verifier = 'v'.repeat(43);

beforeEach(() => {
  const f = fakeD1();
  db = f.db;
  env = { DB: f.d1, APP_URL: 'https://kaiserkhan.com/boardo/' };
  db.exec(
    `INSERT INTO users (id, email, name, created) VALUES ('ann', 'ann@example.com', 'Ann', 1), ('bob', 'bob@example.com', 'Bob', 1)`,
  );
  db.exec(
    `INSERT INTO members (board_id, user_id, role, added_at) VALUES ('b1', 'ann', 'admin', 1), ('b2', 'ann', 'member', 1)`,
  );
});

async function challenge() {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function codeFor(user: string) {
  const { redirect } = await approve(env, user, {
    client_id: 'elastic',
    redirect_uri: ELASTIC,
    state: 's',
    code_challenge: await challenge(),
  });
  return new URL(redirect).searchParams.get('code')!;
}

const links = () => db.prepare(`SELECT user_id, ext, scope FROM app_tokens ORDER BY created`).all();

describe('Elastic link', () => {
  it('finds a Boardo account by email, with its boards', async () => {
    expect(await lookup(env, 'ANN@example.com ')).toEqual({ boards: 2 });
    expect(await lookup(env, 'bob@example.com')).toEqual({ boards: 0 });
    expect(await lookup(env, 'nobody@example.com')).toBeNull();
  });

  it('links by email, one link per Elastic account, usable only over the binding', async () => {
    const first = await linkByEmail(env, 'ann@example.com', 'elastic-1');
    expect(first?.user).toEqual({ email: 'ann@example.com', name: 'Ann' });
    const second = await linkByEmail(env, 'ann@example.com', 'elastic-1');
    expect(links()).toEqual([{ user_id: 'ann', ext: 'elastic-1', scope: 'elastic-link' }]);
    expect(await appUser(env, first!.token, 'elastic-link')).toBeNull();
    expect(await appUser(env, second!.token, 'elastic-link')).toBe('ann');
    // The public /elastic/* routes take only the older per-device tokens.
    expect(await appUser(env, second!.token, 'elastic')).toBeNull();
    expect(await linkByEmail(env, 'nobody@example.com', 'elastic-1')).toBeNull();
    expect(await linkByEmail(env, 'ann@example.com', 'not an id!')).toBeNull();
  });

  it("links another email's account through the connect page's code, once", async () => {
    const code = await codeFor('bob');
    const l = await exchange(env, { code, verifier, redirect_uri: ELASTIC }, 'elastic-1');
    expect(l.user.email).toBe('bob@example.com');
    await expect(exchange(env, { code, verifier, redirect_uri: ELASTIC }, 'elastic-1')).rejects.toThrow(
      /expired or was already used/,
    );
    const wrong = await codeFor('bob');
    await expect(
      exchange(env, { code: wrong, verifier: 'w'.repeat(43), redirect_uri: ELASTIC }, 'elastic-1'),
    ).rejects.toThrow();
  });

  it("hands a device's own token over to the account's link, and revokes it", async () => {
    const old = await token(env, { code: await codeFor('ann'), verifier, client_id: 'elastic', redirect_uri: ELASTIC });
    const l = await adopt(env, old.access_token, 'elastic-1');
    expect(l?.user.email).toBe('ann@example.com');
    expect(await appUser(env, old.access_token, 'elastic')).toBeNull();
    expect(await adopt(env, old.access_token, 'elastic-1')).toBeNull();
    expect(links()).toEqual([{ user_id: 'ann', ext: 'elastic-1', scope: 'elastic-link' }]);
  });

  it('answers for the cards only while the link stands', async () => {
    const link = new ElasticLink({} as never, env);
    const l = await link.linkByEmail('bob@example.com', 'elastic-2');
    expect(await link.cards(l!.token)).toEqual({ boards: 0, cards: [] });
    await link.revoke(l!.token);
    expect(await link.cards(l!.token)).toBeNull();
    expect(await link.ops(l!.token, [])).toBeNull();
    expect(await link.exchange({ code: 'nope', verifier }, 'elastic-2')).toEqual({
      error: 'That code has expired or was already used. Connect again.',
    });
  });

  it('tells Elastic whose cards changed: only accounts linked to the people in the board', async () => {
    const cardsChanged = vi.fn(async () => {});
    env.ELASTIC = { cardsChanged };
    await linkByEmail(env, 'ann@example.com', 'elastic-1');
    // An older per-device token isn't the account's link: nothing to tell.
    await token(env, { code: await codeFor('bob'), verifier, client_id: 'elastic', redirect_uri: ELASTIC });
    await notifyElastic(env, ['ann', 'bob', 'carl']);
    expect(cardsChanged).toHaveBeenCalledWith(['elastic-1']);
    cardsChanged.mockClear();
    await notifyElastic(env, ['bob']);
    expect(cardsChanged).not.toHaveBeenCalled();
  });
  it("tells Elastic at once when the link is taken off in Boardo, so it goes from every device", async () => {
    const cardsChanged = vi.fn(async () => {});
    env.ELASTIC = { cardsChanged };
    const l = await linkByEmail(env, 'ann@example.com', 'elastic-1');
    const [app] = (await listApps(env, 'ann')).apps;
    await revokeApp(env, 'ann', { id: app.id });
    expect(cardsChanged).toHaveBeenCalledWith(['elastic-1']);
    expect(await appUser(env, l!.token, 'elastic-link')).toBeNull();
  });

  it('tells Elastic when a linked Boardo account is deleted', async () => {
    const cardsChanged = vi.fn(async () => {});
    env.ELASTIC = { cardsChanged };
    await linkByEmail(env, 'ann@example.com', 'elastic-1');
    await deleteUser(env, 'ann');
    expect(cardsChanged).toHaveBeenCalledWith(['elastic-1']);
    expect(links()).toEqual([]);
  });
});
