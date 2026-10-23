// Connected apps (R8.1 to R8.5): OAuth 2.0 authorization code with PKCE. Elastic sends the
// person to Boardo's connect page, they allow it, and Elastic swaps the one-time code (with its
// PKCE verifier) for a long-lived token with scope `elastic`. That token works on `/elastic/*`
// only, just as a session token never does; both are stored hashed.

import { getUser, randomToken, Refusal, sha256 } from './auth';
import { isId } from './checks';
import type { Env } from './env';

interface Client {
  name: string;
  redirects: string[];
  scope: string;
}

/** The apps allowed to connect, and where they may send people back to. */
export const CLIENTS: Record<string, Client> = {
  elastic: {
    name: 'Elastic',
    redirects: ['https://kaiserkhan.com/planner/', 'http://localhost:5173/planner/', 'http://localhost:4173/planner/'],
    scope: 'elastic',
  },
};

const CODE_MS = 5 * 60_000;
const IDLE_MS = 365 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;

function client(id: unknown, redirect: unknown): Client {
  const c = typeof id === 'string' ? CLIENTS[id] : undefined;
  if (!c || typeof redirect !== 'string' || !c.redirects.includes(redirect))
    throw new Refusal(400, "That app isn't one Boardo knows, so it can't connect.");
  return c;
}

function back(redirect: string, params: Record<string, string>): string {
  const u = new URL(redirect);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** The person answered the connect page: a one-time code (or a refusal) to send back with. */
export async function approve(env: Env, userId: string, body: Record<string, unknown>): Promise<{ redirect: string }> {
  const c = client(body.client_id, body.redirect_uri);
  const redirect = body.redirect_uri as string;
  const state = typeof body.state === 'string' && body.state.length <= 200 ? body.state : '';
  if (body.deny) return { redirect: back(redirect, { error: 'access_denied', state }) };
  const challenge = body.code_challenge;
  if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || (body.code_challenge_method || 'S256') !== 'S256')
    throw new Refusal(400, "The app's request was incomplete. Start connecting again from the app.");
  const code = randomToken(32);
  await env.DB.prepare(
    'INSERT INTO oauth_codes (code_hash, user_id, client_id, redirect_uri, challenge, scope, expires) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(await sha256(code), userId, body.client_id, redirect, challenge, c.scope, Date.now() + CODE_MS)
    .run();
  return { redirect: back(redirect, { code, state }) };
}

/** Check a one-time code and its PKCE verifier, and use it up: whose it was, and for what. */
export async function redeem(env: Env, body: Record<string, unknown>) {
  const bad = new Refusal(400, 'That code has expired or was already used. Connect again.');
  if (typeof body.code !== 'string' || typeof body.verifier !== 'string' || body.code.length > 100) throw bad;
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(body.verifier)) throw bad;
  const row = await env.DB.prepare('DELETE FROM oauth_codes WHERE code_hash = ? RETURNING *')
    .bind(await sha256(body.code))
    .first<{ user_id: string; client_id: string; redirect_uri: string; challenge: string; scope: string; expires: number }>();
  if (!row || row.expires < Date.now()) throw bad;
  if ((body.client_id ?? row.client_id) !== row.client_id || (body.redirect_uri ?? row.redirect_uri) !== row.redirect_uri) throw bad;
  if ((await sha256(body.verifier)) !== row.challenge) throw bad;
  const user = await getUser(env, row.user_id);
  if (!user) throw bad;
  return { user, clientId: row.client_id, scope: row.scope };
}

/** Swap a code and its PKCE verifier for a token. A code works once, for 5 minutes. */
export async function token(env: Env, body: Record<string, unknown>) {
  const { user, clientId, scope } = await redeem(env, body);
  const access = await issue(env, user.id, clientId, scope, null);
  return { access_token: access, token_type: 'Bearer', scope, user: { email: user.email, name: user.name } };
}

/** A new app token, stored hashed. `ext`: the account in the app it belongs to, if known. */
export async function issue(env: Env, userId: string, clientId: string, scope: string, ext: string | null): Promise<string> {
  const access = randomToken(32);
  const now = Date.now();
  const label = CLIENTS[clientId]?.name ?? clientId;
  await env.DB.prepare(
    'INSERT INTO app_tokens (hash, id, user_id, client_id, scope, label, created, used, ext) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(await sha256(access), randomToken(12), userId, clientId, scope, label, now, now, ext)
    .run();
  return access;
}

/** Whose app token this is, for a scope; null if it isn't one. */
export async function appUser(env: Env, tok: unknown, scope: string): Promise<string | null> {
  if (typeof tok !== 'string' || !tok || tok.length > 100) return null;
  const hash = await sha256(tok);
  const row = await env.DB.prepare('SELECT user_id, scope, used FROM app_tokens WHERE hash = ?')
    .bind(hash)
    .first<{ user_id: string; scope: string; used: number }>();
  if (!row || row.scope !== scope) return null;
  const now = Date.now();
  if (now - row.used > IDLE_MS) {
    await env.DB.prepare('DELETE FROM app_tokens WHERE hash = ?').bind(hash).run();
    return null;
  }
  if (now - row.used > DAY_MS) await env.DB.prepare('UPDATE app_tokens SET used = ? WHERE hash = ?').bind(now, hash).run();
  return row.user_id;
}

export async function listApps(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    'SELECT id, label, client_id AS client, created, used FROM app_tokens WHERE user_id = ? ORDER BY created DESC',
  )
    .bind(userId)
    .all<{ id: string; label: string; client: string; created: number; used: number }>();
  return { apps: rows.results };
}

export async function revokeApp(env: Env, userId: string, body: { id?: unknown }) {
  if (!isId(body.id)) return;
  await env.DB.prepare('DELETE FROM app_tokens WHERE id = ? AND user_id = ?').bind(body.id, userId).run();
}

/** Disconnecting from the app's side: the token revokes itself. */
export async function revokeSelf(env: Env, tok: unknown) {
  if (typeof tok !== 'string' || tok.length > 100) return;
  await env.DB.prepare('DELETE FROM app_tokens WHERE hash = ?').bind(await sha256(tok)).run();
}
