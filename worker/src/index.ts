// Boardo's Worker: the API behind the app.
//
// - Signing in by email code (auth.ts) and the directory of boards, members and invites
//   (boards.ts), kept in D1.
// - One Board Durable Object per board (board.ts) holds its content. Devices sync with it over a
//   WebSocket (`/sync`), once the Worker has checked they're a member.
//
// Everything else is POST with a JSON body and the session token as `Authorization: Bearer`.

import { Board } from './board';
import {
  acceptInvite,
  boardInvites,
  boardStub,
  createBoard,
  createInvite,
  declineInvite,
  deleteBoard,
  deleteCard,
  leaveAll,
  listBoards,
  orderBoards,
  refreshMemberships,
  removeMember,
  resendInvite,
  revokeInvite,
  roleIn,
  setRole,
} from './boards';
import {
  deleteUser,
  getUser,
  handoffFinish,
  handoffStart,
  network,
  Refusal,
  sendCode,
  sendEmailChange,
  sessionUser,
  signOut,
  signOutOthers,
  updateMe,
  verifyCode,
  verifyEmailChange,
} from './auth';
import { type Env, isDev, list } from './env';
import { links, putPhoto, remove as removeFile, removePhoto, serve as serveFile, servePhoto, upload } from './files';
import { devOutbox } from './mail';
import { elasticCards, elasticOps } from './elastic';
import { listNotes, readNotes, seenNotes, subscribe, subscribed, unsubscribe } from './inbox';
import { ElasticLink } from './link';
import { listPasskeys, loginFinish, loginStart, registerFinish, registerStart, removePasskey } from './passkeys';
import { approve, appUser, listApps, revokeApp, revokeSelf, token as oauthToken } from './oauth';

export { Board, ElasticLink };

/** The app's own addresses (src/lib/route.ts), served its page. */
const APP_PAGE = /^\/(?:my-cards|account|b\/[A-Za-z0-9_-]{1,64}(?:\/[^/]+){0,4})\/?$/;

/** Routes anyone can call without signing in: limited per network, on top of auth.ts's limits. */
const OPEN = new Set([
  '/auth/code/send',
  '/auth/code/verify',
  '/auth/passkey/login/start',
  '/auth/passkey/login/finish',
  '/auth/handoff',
  '/oauth/token',
]);

/**
 * Signed-in routes that write: limited per person (USER_LIMITER), so no one account can use up
 * the day's database writes. Uploads (PUT) count too.
 */
const WRITES = new Set([
  '/account/handoff',
  '/auth/passkey/add/start',
  '/auth/passkey/add/finish',
  '/auth/signout/others',
  '/me',
  '/me/email/send',
  '/me/email/verify',
  '/me/photo',
  '/me/photo/remove',
  '/me/delete',
  '/me/passkeys/remove',
  '/boards/order',
  '/boards/create',
  '/boards/delete',
  '/cards/delete',
  '/members/role',
  '/members/remove',
  '/invites/create',
  '/invites/accept',
  '/invites/decline',
  '/invites/revoke',
  '/invites/resend',
  '/files',
  '/files/delete',
  '/oauth/approve',
  '/apps/revoke',
  '/notes/seen',
  '/notes/read',
  '/push/subscribe',
  '/push/unsubscribe',
]);

/**
 * What the farewell build at the app's old address (LEGACY_ORIGINS) calls while it hands a copy
 * over (src/lib/move.ts, App.moveHome()): the board list and the bell as it starts, syncing and
 * uploading what's waiting, then the one-time code. Nothing else is taken from there, so no
 * page on that site can sign in, use a passkey or change an account.
 */
const FAREWELL = new Set(['/sync', '/sync/http', '/boards', '/boards/order', '/notes', '/files', '/files/links', '/account/handoff', '/auth/signout']);

/** Whether a page at `origin` may call `path`. */
function originAllowed(env: Env, origin: string, path: string): boolean {
  if (!origin) return false;
  if (list(env.ALLOWED_ORIGINS).includes(origin)) return true;
  if (isDev(env) && list(env.DEV_ORIGINS).includes(origin)) return true;
  return FAREWELL.has(path) && list(env.LEGACY_ORIGINS).includes(origin);
}

const MAX_BODY = 64 * 1024;
/** A put sent over /sync/http carries a batch of records (the app keeps a batch under 400 kB). */
const MAX_SYNC_BODY = 1024 * 1024;

export default {
  async fetch(req, env): Promise<Response> {
    const origin = req.headers.get('origin') ?? '';
    // On the app's own address (boardo.kaiserkhan.com) the API is under /api, and everything
    // else is the app's files (served before this runs). On workers.dev, which app versions from
    // before the move call, it's at the root.
    let { pathname } = new URL(req.url);
    const prefix = pathname.startsWith('/api/') ? '/api' : '';
    if (prefix) pathname = pathname.slice(prefix.length);
    const allowed = originAllowed(env, origin, pathname);
    const cors: Record<string, string> = allowed
      ? {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST, PUT',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-max-age': '86400',
          vary: 'origin',
        }
      : {};
    const reply = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers:
          body === undefined ? cors : { ...cors, 'content-type': 'application/json', 'x-content-type-options': 'nosniff' },
      });

    if (req.method === 'OPTIONS') return reply(allowed ? 204 : 403);
    // A place in the app (a board, a card, My cards, Account: src/lib/route.ts) is the app's page,
    // which reads the address itself. Only these paths, so nothing else is ever masked.
    if (!prefix && req.method === 'GET' && env.ASSETS && APP_PAGE.test(pathname))
      return env.ASSETS.fetch(new Request(new URL('/', req.url), { headers: req.headers }));
    // Signed file links are opened by <img> tags and downloads, which send no Origin: the
    // signature is the check.
    if (req.method === 'GET' && (pathname.startsWith('/files/') || pathname.startsWith('/photos/')))
      try {
        return await (pathname.startsWith('/files/') ? serveFile(req, env, pathname) : servePhoto(req, env, pathname));
      } catch (e) {
        if (e instanceof Refusal) return new Response(e.message, { status: e.status });
        console.error(e);
        return new Response('Something went wrong. Try again.', { status: 500 });
      }
    if (!allowed) return reply(403);

    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    /** One more write by this person; false once they've made too many this minute. */
    const mayWrite = async (userId: string) => !env.USER_LIMITER || (await env.USER_LIMITER.limit({ key: userId })).success;
    const tooMany = () => reply(429, { error: 'Too many changes at once. Try again in a minute.' });

    if (pathname === '/sync') return connect(req, env);
    if (req.method === 'PUT' && (pathname === '/files' || pathname === '/me/photo')) {
      try {
        const who = await sessionUser(env, req.headers.get('authorization')?.replace(/^Bearer /, ''));
        if (who && !(await mayWrite(who))) return tooMany();
        if (pathname === '/me/photo') {
          const res = await putPhoto(req, env);
          const id = await sessionUser(env, req.headers.get('authorization')?.replace(/^Bearer /, ''));
          const user = id ? await getUser(env, id) : null;
          if (user) await refreshMemberships(env, user);
          return reply(200, { ...res, user });
        }
        return reply(200, await upload(req, env));
      } catch (e) {
        if (e instanceof Refusal) return reply(e.status, { error: e.message });
        console.error(e);
        return reply(500, { error: "The file couldn't be stored. Try again." });
      }
    }
    if (req.method !== 'POST') return reply(404);
    if (OPEN.has(pathname) && env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: network(ip) });
      if (!success) return reply(429, { error: 'Too many requests. Try again in a minute.' });
    }

    let body: Record<string, unknown>;
    try {
      const text = await req.text();
      if (text.length > (pathname === '/sync/http' ? MAX_SYNC_BODY : MAX_BODY)) return reply(413);
      body = text ? JSON.parse(text) : {};
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400);
    } catch {
      return reply(400);
    }

    try {
      const token = req.headers.get('authorization')?.replace(/^Bearer /, '');
      const mustApp = async () => {
        const id = await appUser(env, token, 'elastic');
        if (!id) throw new Refusal(401, 'Disconnected');
        return id;
      };
      let me: string | null = null;
      const mustUser = async () => {
        if (me) return me;
        const id = await sessionUser(env, token);
        if (!id) throw new Refusal(401, 'Signed out');
        if (WRITES.has(pathname) && !(await mayWrite(id))) throw new Refusal(429, 'Too many changes at once. Try again in a minute.');
        return (me = id);
      };

      switch (pathname) {
        case '/sync/http': {
          // The board's sync for networks that block WebSockets (see Board.httpSync).
          const userId = await mustUser();
          const role = await roleIn(env, body.board, userId);
          const m = body.m;
          if (!m || typeof m !== 'object' || Array.isArray(m)) return reply(400);
          if (!role) return reply(200, { msgs: [{ t: 'removed' }] });
          const msgs = await boardStub(env, body.board as string).httpSync(userId, role, m as Record<string, unknown>);
          // Too many changes too fast: the device tries again after a pause.
          if (!msgs) return tooMany();
          return reply(200, { msgs });
        }
        case '/auth/code/send':
          await sendCode(env, body, ip);
          return reply(204);
        case '/auth/code/verify':
          return reply(200, await verifyCode(env, body));
        case '/auth/handoff':
          return reply(200, await handoffFinish(env, body));
        case '/account/handoff':
          return reply(200, await handoffStart(env, await mustUser(), token));
        case '/auth/passkey/login/start':
          return reply(200, await loginStart(env, origin));
        case '/auth/passkey/login/finish':
          return reply(200, await loginFinish(env, origin, body));
        case '/auth/passkey/add/start':
          return reply(200, await registerStart(env, origin, await mustUser()));
        case '/auth/passkey/add/finish':
          await registerFinish(env, origin, await mustUser(), body, req.headers.get('user-agent') ?? '');
          return reply(204);
        case '/me/passkeys':
          return reply(200, await listPasskeys(env, await mustUser()));
        case '/me/passkeys/remove':
          await removePasskey(env, await mustUser(), body);
          return reply(204);
        case '/auth/signout':
          if (token) await signOut(env, token);
          return reply(204);
        case '/auth/signout/others':
          await signOutOthers(env, await mustUser(), token);
          return reply(204);

        case '/me': {
          const id = await mustUser();
          if (body.name === undefined && body.hue === undefined) {
            const user = await getUser(env, id);
            if (!user) throw new Refusal(401, 'Signed out');
            return reply(200, { user });
          }
          const user = await updateMe(env, id, body);
          await refreshMemberships(env, user);
          return reply(200, { user });
        }
        case '/me/email/send':
          await sendEmailChange(env, await mustUser(), body, ip);
          return reply(204);
        case '/me/email/verify': {
          const user = await verifyEmailChange(env, await mustUser(), body, token);
          await refreshMemberships(env, user);
          return reply(200, { user });
        }
        case '/me/photo/remove': {
          const id = await mustUser();
          await removePhoto(env, id);
          const user = await getUser(env, id);
          if (user) await refreshMemberships(env, user);
          return reply(200, { user });
        }
        case '/me/delete': {
          const id = await mustUser();
          await leaveAll(env, id);
          await removePhoto(env, id);
          await deleteUser(env, id);
          return reply(204);
        }

        case '/boards':
          return reply(200, await listBoards(env, await mustUser()));
        case '/boards/order':
          await orderBoards(env, await mustUser(), body);
          return reply(204);
        case '/boards/create':
          return reply(200, { board: await createBoard(env, await mustUser(), body) });
        case '/boards/delete':
          await deleteBoard(env, await mustUser(), body);
          return reply(204);

        case '/cards/delete':
          await deleteCard(env, await mustUser(), body);
          return reply(204);

        case '/members/role':
          await setRole(env, await mustUser(), body);
          return reply(204);
        case '/members/remove':
          await removeMember(env, await mustUser(), body);
          return reply(204);

        case '/invites':
          return reply(200, await boardInvites(env, await mustUser(), body));
        case '/invites/create':
          await createInvite(env, await mustUser(), body);
          return reply(204);
        case '/invites/accept':
          return reply(200, await acceptInvite(env, await mustUser(), body));
        case '/invites/decline':
          await declineInvite(env, await mustUser(), body);
          return reply(204);
        case '/invites/revoke':
          await revokeInvite(env, await mustUser(), body);
          return reply(204);
        case '/invites/resend':
          await resendInvite(env, await mustUser(), body);
          return reply(204);

        case '/files/links':
          return reply(200, await links(env, await mustUser(), body, new URL(req.url).origin + prefix));
        case '/files/delete':
          await removeFile(env, await mustUser(), body);
          return reply(204);

        case '/oauth/approve':
          return reply(200, await approve(env, await mustUser(), body));
        case '/oauth/token':
          return reply(200, await oauthToken(env, body));
        case '/apps':
          return reply(200, await listApps(env, await mustUser()));
        case '/apps/revoke':
          await revokeApp(env, await mustUser(), body);
          return reply(204);

        // The bell (inbox.ts).
        case '/notes':
          return reply(200, await listNotes(env, await mustUser()));
        case '/notes/seen':
          await seenNotes(env, await mustUser());
          return reply(204);
        case '/notes/read':
          await readNotes(env, await mustUser(), body);
          return reply(204);
        case '/push/subscribe':
          if (!(await subscribe(env, await mustUser(), body))) return reply(400, { error: "This browser can't take alerts." });
          return reply(204);
        case '/push/unsubscribe':
          await unsubscribe(env, await mustUser(), body);
          return reply(204);
        case '/push/status':
          return reply(200, { on: await subscribed(env, await mustUser(), body) });

        case '/elastic/cards':
          return reply(200, await elasticCards(env, await mustApp()));
        case '/elastic/ops':
          return reply(200, await elasticOps(env, await mustApp(), body));
        case '/elastic/disconnect':
          await revokeSelf(env, token);
          return reply(204);

        case '/dev/mail':
          if (!env.DEV_MAIL || env.RESEND_API_KEY) return reply(404);
          return reply(200, { mail: devOutbox });
      }
      return reply(404);
    } catch (e) {
      if (e instanceof Refusal) return reply(e.status, { error: e.message });
      console.error(e);
      return reply(500, { error: 'Something went wrong. Try again.' });
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * A device's live connection to one board. Browsers can't set headers on a WebSocket, so the
 * token comes as the second subprotocol. Someone signed out, or not in the board, still gets a
 * connection, which only says so and closes (a refused upgrade would look like the network
 * dropping, and the app would keep retrying).
 */
async function connect(req: Request, env: Env): Promise<Response> {
  if (req.headers.get('upgrade') !== 'websocket') return new Response(null, { status: 426 });
  const boardId = new URL(req.url).searchParams.get('board');
  const [proto, token] = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map((s) => s.trim());
  const userId = proto === 'boardo' ? await sessionUser(env, token) : null;
  const role = userId ? await roleIn(env, boardId, userId) : null;
  if (userId && role) {
    const headers = new Headers(req.headers);
    headers.set('x-user', userId);
    headers.set('x-role', role);
    return boardStub(env, boardId!).fetch(new Request(req.url, { headers }));
  }
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ t: userId ? 'removed' : 'signedout' }));
  server.close(userId ? 4003 : 4001, userId ? 'Not in this board' : 'Signed out');
  return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'boardo' } });
}
