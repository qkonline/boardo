// Connected apps (oauth.ts): the authorization code with PKCE, on the directory in node:sqlite.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeD1 } from '../../test/fake-d1';
import { b64url } from './auth';
import { appUser, approve, revokeApp, revokeSelf, token } from './oauth';

let db: ReturnType<typeof fakeD1>['db'];
let env: any;

const ELASTIC = 'https://elastic.kaiserkhan.com/';
const verifier = 'v'.repeat(48);
const challenge = async (v: string) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));

async function codeFor(redirect = ELASTIC, e = env) {
  const { redirect: back } = await approve(e, 'ann', {
    client_id: 'elastic',
    redirect_uri: redirect,
    state: 's',
    code_challenge: await challenge(verifier),
  });
  return new URL(back).searchParams.get('code')!;
}

beforeEach(() => {
  const f = fakeD1();
  db = f.db;
  env = { DB: f.d1 };
  db.exec(`INSERT INTO users (id, email, name, created) VALUES ('ann', 'ann@x.com', 'Ann', 1)`);
});

describe('connecting an app', () => {
  it('swaps a code and its verifier for a token, once', async () => {
    const code = await codeFor();
    const res = await token(env, { code, verifier, client_id: 'elastic', redirect_uri: ELASTIC });
    expect(res).toMatchObject({ token_type: 'Bearer', scope: 'elastic', user: { email: 'ann@x.com' } });
    expect(await appUser(env, res.access_token, 'elastic')).toBe('ann');
    await expect(token(env, { code, verifier, client_id: 'elastic', redirect_uri: ELASTIC })).rejects.toThrow(/expired/);
  });

  it('refuses a redirect that isn\'t registered', async () => {
    await expect(codeFor('https://evil.example/')).rejects.toThrow(/isn't one Boardo knows/);
    await expect(codeFor('https://kaiserkhan.com/planner/')).rejects.toThrow(/isn't one Boardo knows/);
  });

  it('takes local addresses only when running locally', async () => {
    await expect(codeFor('http://localhost:5173/')).rejects.toThrow(/isn't one Boardo knows/);
    expect(await codeFor('http://localhost:5173/', { ...env, DEV_MAIL: '1' })).toBeTruthy();
  });

  it('refuses the wrong verifier, and the code is used up', async () => {
    const code = await codeFor();
    await expect(token(env, { code, verifier: 'w'.repeat(48), client_id: 'elastic', redirect_uri: ELASTIC })).rejects.toThrow(/expired/);
    await expect(token(env, { code, verifier, client_id: 'elastic', redirect_uri: ELASTIC })).rejects.toThrow(/expired/);
  });

  it('needs the redirect the code was given for', async () => {
    await expect(token(env, { code: await codeFor(), verifier, client_id: 'elastic' })).rejects.toThrow(/expired/);
    await expect(
      token(env, { code: await codeFor(), verifier, client_id: 'elastic', redirect_uri: 'https://elastic.kaiserkhan.com/x' }),
    ).rejects.toThrow(/expired/);
  });

  it('refuses a code more than five minutes old', async () => {
    const code = await codeFor();
    db.prepare('UPDATE oauth_codes SET expires = ?').run(Date.now() - 1);
    await expect(token(env, { code, verifier, client_id: 'elastic', redirect_uri: ELASTIC })).rejects.toThrow(/expired/);
  });

  it('refuses a token once it is revoked, from either side', async () => {
    const a = (await token(env, { code: await codeFor(), verifier, client_id: 'elastic', redirect_uri: ELASTIC })).access_token;
    const b = (await token(env, { code: await codeFor(), verifier, client_id: 'elastic', redirect_uri: ELASTIC })).access_token;
    const { id } = db.prepare('SELECT id FROM app_tokens ORDER BY rowid LIMIT 1').get() as { id: string };
    await revokeApp(env, 'ann', { id });
    expect(await appUser(env, a, 'elastic')).toBeNull();
    await revokeSelf(env, b);
    expect(await appUser(env, b, 'elastic')).toBeNull();
  });

  it('never takes an app token for another scope', async () => {
    const t = (await token(env, { code: await codeFor(), verifier, client_id: 'elastic', redirect_uri: ELASTIC })).access_token;
    expect(await appUser(env, t, 'elastic-link')).toBeNull();
  });
});
