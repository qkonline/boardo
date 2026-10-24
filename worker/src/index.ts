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
  Refusal,
  sendCode,
  sendEmailChange,
  sessionUser,
  signOut,
  updateMe,
  verifyCode,
  verifyEmailChange,
} from './auth';
import type { Env } from './env';
import { links, putPhoto, remove as removeFile, removePhoto, serve as serveFile, servePhoto, upload } from './files';
import { devOutbox } from './mail';
import { elasticCards, elasticOps } from './elastic';
import { listNotes, readNotes, seenNotes, subscribe, subscribed, unsubscribe } from './inbox';
import { ElasticLink } from './link';
import { listPasskeys, loginFinish, loginStart, registerFinish, registerStart, removePasskey } from './passkeys';
import { approve, appUser, listApps, revokeApp, revokeSelf, token as oauthToken } from './oauth';

export { Board, ElasticLink };

/** Routes anyone can call without signing in: limited per network, on top of auth.ts's limits. */
const OPEN = new Set([
  '/auth/code/send',
  '/auth/code/verify',
  '/auth/passkey/login/start',
  '/auth/passkey/login/finish',
  '/auth/handoff',
  '/oauth/token',
]);

const MAX_BODY = 64 * 1024;
/** A put sent over /sync/http carries a batch of records (the app keeps a batch under 400 kB). */
const MAX_SYNC_BODY = 1024 * 1024;

export default {
  async fetch(req, env): Promise<Response> {
    const origin = req.headers.get('origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',').some((o) => o.trim() === origin);
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
        headers: body === undefined ? cors : { ...cors, 'content-type': 'application/json' },
      });

    if (req.method === 'OPTIONS') return reply(allowed ? 204 : 403);
    // On the app's own address (boardo.kaiserkhan.com) the API is under /api, and everything
    // else is the app's files (served before this runs). On workers.dev, which app versions from
    // before the move call, it's at the root.
    let { pathname } = new URL(req.url);
    const prefix = pathname.startsWith('/api/') ? '/api' : '';
    if (prefix) pathname = pathname.slice(prefix.length);
    // Signed file links are opened by <img> tags and downloads, which send no Origin: the
    // signature is the check.
    if (req.method === 'GET' && pathname.startsWith('/files/')) return serveFile(req, env, pathname);
    if (req.method === 'GET' && pathname.startsWith('/photos/')) return servePhoto(req, env, pathname);
    if (!allowed) return reply(403);

    if (pathname === '/sync') return connect(req, env);
    if (req.method === 'PUT' && (pathname === '/files' || pathname === '/me/photo')) {
      try {
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
      const { success } = await env.LIMITER.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' });
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
      const mustUser = async () => {
        const id = await sessionUser(env, token);
        if (!id) throw new Refusal(401, 'Signed out');
        return id;
      };

      switch (pathname) {
        case '/sync/http': {
          // The board's sync for networks that block WebSockets (see Board.httpSync).
          const userId = await mustUser();
          const role = await roleIn(env, body.board, userId);
          const m = body.m;
          if (!m || typeof m !== 'object' || Array.isArray(m)) return reply(400);
          if (!role) return reply(200, { msgs: [{ t: 'removed' }] });
          return reply(200, {
            msgs: await boardStub(env, body.board as string).httpSync(userId, role, m as Record<string, unknown>),
          });
        }
        case '/auth/code/send':
          await sendCode(env, body, req.headers.get('cf-connecting-ip') ?? 'local');
          return reply(204);
        case '/auth/code/verify':
          return reply(200, await verifyCode(env, body));
        case '/auth/handoff':
          return reply(200, await handoffFinish(env, body));
        case '/account/handoff':
          return reply(200, await handoffStart(env, await mustUser()));
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
          await sendEmailChange(env, await mustUser(), body, req.headers.get('cf-connecting-ip') ?? 'local');
          return reply(204);
        case '/me/email/verify': {
          const user = await verifyEmailChange(env, await mustUser(), body);
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
