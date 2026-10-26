// The directory side of boards: which boards someone is in, making and deleting boards, members
// and their roles, and invites. D1 is the source of truth for who's in a board; each change is
// passed on to the board itself (board.ts) so its member list and open connections follow.

import type { BoardRec, Hue, MemberRec, Role } from '../../shared/model';
import { DEFAULT_UPLOAD_MB } from '../../shared/model';
import { getUser, randomToken, Refusal, sha256, type User } from './auth';
import { cleanEmail, isHue, isId, text } from './checks';
import type { Env } from './env';
import { dropBoardNotes } from './inbox';
import { sendMail } from './mail';

const INVITE_MS = 14 * 24 * 3600_000;
const MAX_BOARDS = 200;

export const boardStub = (env: Env, id: string) => env.BOARDS.get(env.BOARDS.idFromName(id));

/**
 * Pass a change in the directory on to the board, trying again if the call fails (each try
 * with a new stub). If it still fails, the person asking sees an error, and asking again
 * finishes the job: the steps below pass the change on even when the directory already has it.
 */
async function tellBoard(fn: () => Promise<unknown>): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fn();
      return;
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
}

export async function roleIn(env: Env, boardId: unknown, userId: string): Promise<Role | null> {
  if (!isId(boardId)) return null;
  const row = await env.DB.prepare('SELECT role FROM members WHERE board_id = ? AND user_id = ?')
    .bind(boardId, userId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

async function mustAdmin(env: Env, boardId: unknown, userId: string): Promise<string> {
  const role = await roleIn(env, boardId, userId);
  if (!role) throw new Refusal(404, "That board isn't there any more.");
  if (role !== 'admin') throw new Refusal(403, 'Only admins can do that.');
  return boardId as string;
}

const memberRec = (u: User, role: Role): MemberRec => ({
  userId: u.id,
  name: u.name ?? u.email.split('@')[0],
  email: u.email,
  hue: u.hue as Hue,
  role,
  photo: u.photo ?? null,
});

/** The boards someone is in, and the invites waiting for their address. */
/** This person's own order of their boards (R2.5a). Boards they aren't in are ignored; boards left out keep their place. */
export async function orderBoards(env: Env, userId: string, body: { ids?: unknown }) {
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length > MAX_BOARDS || !ids.every((x) => typeof x === 'string' && x.length <= 64))
    throw new Refusal(400, 'Bad order');
  if (!ids.length) return;
  await env.DB.batch(
    ids.map((id, i) => env.DB.prepare('UPDATE members SET position = ? WHERE board_id = ? AND user_id = ?').bind(i + 1, id, userId)),
  );
}

export async function listBoards(env: Env, userId: string) {
  const user = await getUser(env, userId);
  if (!user) throw new Refusal(401, 'Signed out');
  const boards = await env.DB.prepare(
    'SELECT b.id, b.name, b.hue, m.role FROM members m JOIN boards b ON b.id = m.board_id WHERE m.user_id = ? ORDER BY m.position IS NULL, m.position, b.created',
  )
    .bind(userId)
    .all<{ id: string; name: string; hue: string; role: Role }>();
  const invites = await env.DB.prepare(
    `SELECT i.id, i.role, i.expires, b.name AS boardName, b.hue AS boardHue, u.name AS byName, u.email AS byEmail
     FROM invites i JOIN boards b ON b.id = i.board_id LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.email = ? AND i.expires > ? ORDER BY i.created`,
  )
    .bind(user.email, Date.now())
    .all<{ id: string; role: Role; expires: number; boardName: string; boardHue: string; byName: string | null; byEmail: string | null }>();
  return {
    user,
    boards: boards.results,
    invites: invites.results.map((i) => ({
      id: i.id,
      role: i.role,
      expires: i.expires,
      board: { name: i.boardName, hue: i.boardHue },
      by: i.byName ?? i.byEmail ?? null,
    })),
  };
}

export async function createBoard(env: Env, userId: string, body: { name?: unknown; hue?: unknown }) {
  const name = text(body.name, 100)?.trim();
  if (!name) throw new Refusal(400, 'Give the board a name.');
  const hue = isHue(body.hue) ? body.hue : 'indigo';
  const user = await getUser(env, userId);
  if (!user) throw new Refusal(401, 'Signed out');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE user_id = ?').bind(userId).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_BOARDS) throw new Refusal(400, "You're in as many boards as Boardo allows.");
  const id = randomToken(12);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO boards (id, name, hue, created_by, created) VALUES (?, ?, ?, ?, ?)').bind(id, name, hue, userId, now),
    env.DB.prepare("INSERT INTO members (board_id, user_id, role, added_at) VALUES (?, ?, 'admin', ?)").bind(id, userId, now),
  ]);
  const board: BoardRec = { name, hue, maxUploadMB: DEFAULT_UPLOAD_MB };
  await boardStub(env, id).init(id, board, memberRec(user, 'admin'));
  return { id, name, hue, role: 'admin' as Role };
}

export async function deleteBoard(env: Env, userId: string, body: { board?: unknown }) {
  const id = await mustAdmin(env, body.board, userId);
  const stub = boardStub(env, id);
  const keys = await stub.fileKeys();
  for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
  await stub.erase();
  await dropBoardNotes(env, id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM members WHERE board_id = ?').bind(id),
    env.DB.prepare('DELETE FROM invites WHERE board_id = ?').bind(id),
    env.DB.prepare('DELETE FROM boards WHERE id = ?').bind(id),
  ]);
}

/**
 * Part of a statement that holds only while another admin stays. Checked in the same statement
 * as the change, so two admins taking each other off at once can't leave a board with none.
 */
const ANOTHER_ADMIN = "(role <> 'admin' OR (SELECT COUNT(*) FROM members WHERE board_id = ? AND role = 'admin') > 1)";

const LAST_ADMIN = 'A board needs at least one admin. Make someone else an admin first.';

export async function setRole(env: Env, userId: string, body: { board?: unknown; user?: unknown; role?: unknown }) {
  const boardId = await mustAdmin(env, body.board, userId);
  const role = body.role;
  if (role !== 'admin' && role !== 'member') throw new Refusal(400, 'Pick admin or member.');
  if (!isId(body.user)) throw new Refusal(400, 'Pick someone.');
  const target = body.user;
  const cur = await roleIn(env, boardId, target);
  if (!cur) throw new Refusal(404, "They're not in this board any more.");
  if (cur !== role) {
    const r = await env.DB.prepare(`UPDATE members SET role = ? WHERE board_id = ? AND user_id = ? AND ${ANOTHER_ADMIN}`)
      .bind(role, boardId, target, boardId)
      .run();
    if (!r.meta.changes) {
      if (await roleIn(env, boardId, target)) throw new Refusal(409, LAST_ADMIN);
      throw new Refusal(404, "They're not in this board any more.");
    }
  }
  // Also when the directory has it already: an earlier try may not have reached the board.
  const u = await getUser(env, target);
  if (u) await tellBoard(() => boardStub(env, boardId).setMember(memberRec(u, role), userId));
}

/** Remove someone from a board (an admin), or leave it (anyone). */
export async function removeMember(env: Env, userId: string, body: { board?: unknown; user?: unknown }) {
  const target = body.user ?? userId;
  if (!isId(target)) throw new Refusal(400, 'Pick someone.');
  const boardId = target === userId ? body.board : await mustAdmin(env, body.board, userId);
  if (!isId(boardId)) return;
  const cur = await roleIn(env, boardId, target);
  if (cur) {
    const r = await env.DB.prepare(`DELETE FROM members WHERE board_id = ? AND user_id = ? AND ${ANOTHER_ADMIN}`)
      .bind(boardId, target, boardId)
      .run();
    if (!r.meta.changes && (await roleIn(env, boardId, target)))
      throw new Refusal(409, target === userId ? "You're the only admin. Make someone else an admin, or delete the board." : LAST_ADMIN);
  } else if (!(await env.DB.prepare('SELECT 1 FROM boards WHERE id = ?').bind(boardId).first())) return;
  // Also when the directory has it already: an earlier try may not have reached the board.
  await tellBoard(() => boardStub(env, boardId).removeMember(target, userId));
}

/** Someone changed their name or colour: every board they're in shows it. */
export async function refreshMemberships(env: Env, user: User) {
  const rows = await env.DB.prepare('SELECT board_id, role FROM members WHERE user_id = ?')
    .bind(user.id)
    .all<{ board_id: string; role: Role }>();
  await Promise.all(rows.results.map((r) => boardStub(env, r.board_id).setMember(memberRec(user, r.role), null)));
}

/** Before an account goes: refused while it's a board's only admin; otherwise it leaves every board. */
export async function leaveAll(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT m.board_id, m.role, b.name,
       (SELECT COUNT(*) FROM members a WHERE a.board_id = m.board_id AND a.role = 'admin') AS admins
     FROM members m JOIN boards b ON b.id = m.board_id WHERE m.user_id = ?`,
  )
    .bind(userId)
    .all<{ board_id: string; role: Role; name: string; admins: number }>();
  const stuck = rows.results.find((r) => r.role === 'admin' && r.admins <= 1);
  if (stuck)
    throw new Refusal(409, `You're the only admin of ${stuck.name}. Make someone else an admin, or delete the board, first.`);
  for (const r of rows.results) {
    const res = await env.DB.prepare(`DELETE FROM members WHERE board_id = ? AND user_id = ? AND ${ANOTHER_ADMIN}`)
      .bind(r.board_id, userId, r.board_id)
      .run();
    if (!res.meta.changes)
      throw new Refusal(409, `You're the only admin of ${r.name}. Make someone else an admin, or delete the board, first.`);
    await tellBoard(() => boardStub(env, r.board_id).removeMember(userId, userId));
  }
}

/** Delete an archived card for good (an admin, or whoever made it), with its files. */
export async function deleteCard(env: Env, userId: string, body: { board?: unknown; card?: unknown }) {
  const role = await roleIn(env, body.board, userId);
  if (!role) throw new Refusal(404, "That board isn't there any more.");
  if (!isId(body.card)) throw new Refusal(400, 'Pick a card.');
  const res = await boardStub(env, body.board as string).deleteCard(userId, role, body.card);
  if (res === 'denied') throw new Refusal(403, 'Only admins, or whoever made the card, can delete it.');
  if (res === 'live') throw new Refusal(409, 'Archive the card before deleting it.');
  if (res === 'gone') return;
  for (let i = 0; i < res.keys.length; i += 1000) await env.FILES.delete(res.keys.slice(i, i + 1000));
}

// ---------- invites ----------

function inviteLink(env: Env, token: string): string {
  return `${env.APP_URL.replace(/\/?$/, '/')}?invite=${token}`;
}

async function mailInvite(env: Env, to: string, token: string, boardName: string, by: User, role: Role) {
  const who = by.name ?? by.email;
  const link = inviteLink(env, token);
  const as = role === 'admin' ? 'an admin' : 'a member';
  await sendMail(env, {
    to,
    subject: `${who} invited you to ${boardName} on Boardo`,
    text: `${who} invited you to join ${boardName} on Boardo as ${as}.\n\nJoin the board: ${link}\n\nSign in with this email address (${to}). The invite works for 14 days.`,
    html: `<p style="font:16px/1.5 system-ui,sans-serif">${esc(who)} invited you to join <b>${esc(boardName)}</b> on Boardo as ${as}.</p>
<p><a href="${link}" style="display:inline-block;font:600 15px system-ui,sans-serif;background:#16181d;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Join the board</a></p>
<p style="font:14px/1.5 system-ui,sans-serif;color:#5b6170">Sign in with this email address (${esc(to)}). The invite works for 14 days.</p>`,
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function createInvite(env: Env, userId: string, body: { board?: unknown; email?: unknown; role?: unknown }) {
  const boardId = await mustAdmin(env, body.board, userId);
  const email = cleanEmail(body.email);
  if (!email) throw new Refusal(400, "That doesn't look like an email address.");
  const role: Role = body.role === 'admin' ? 'admin' : 'member';
  const already = await env.DB.prepare(
    'SELECT 1 FROM members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? AND u.email = ?',
  )
    .bind(boardId, email)
    .first();
  if (already) throw new Refusal(409, "They're already in this board.");
  const pending = await env.DB.prepare('SELECT COUNT(*) AS n FROM invites WHERE board_id = ?').bind(boardId).first<{ n: number }>();
  if ((pending?.n ?? 0) >= 100) throw new Refusal(400, 'Too many invites waiting. Cancel some first.');
  const by = await getUser(env, userId);
  const board = await env.DB.prepare('SELECT name FROM boards WHERE id = ?').bind(boardId).first<{ name: string }>();
  if (!by || !board) throw new Refusal(404, "That board isn't there any more.");
  const token = randomToken(24);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM invites WHERE board_id = ? AND email = ?').bind(boardId, email),
    env.DB.prepare(
      'INSERT INTO invites (id, board_id, email, role, token_hash, invited_by, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(randomToken(12), boardId, email, role, await sha256(token), userId, now, now + INVITE_MS),
  ]);
  await mailInvite(env, email, token, board.name, by, role);
}

/** The invites waiting in a board (admins). */
export async function boardInvites(env: Env, userId: string, body: { board?: unknown }) {
  const boardId = await mustAdmin(env, body.board, userId);
  const rows = await env.DB.prepare('SELECT id, email, role, created, expires FROM invites WHERE board_id = ? ORDER BY created')
    .bind(boardId)
    .all<{ id: string; email: string; role: Role; created: number; expires: number }>();
  return { invites: rows.results };
}

type InviteRow = { id: string; board_id: string; email: string; role: Role; expires: number; invited_by: string };

/** Join a board from an invite: by the link's token, or by id from the invites on Home. */
export async function acceptInvite(env: Env, userId: string, body: { token?: unknown; id?: unknown }) {
  const user = await getUser(env, userId);
  if (!user) throw new Refusal(401, 'Signed out');
  let row: InviteRow | null = null;
  if (typeof body.token === 'string' && body.token.length <= 100)
    row = await env.DB.prepare('SELECT * FROM invites WHERE token_hash = ?').bind(await sha256(body.token)).first<InviteRow>();
  else if (isId(body.id)) row = await env.DB.prepare('SELECT * FROM invites WHERE id = ?').bind(body.id).first<InviteRow>();
  if (!row || row.expires < Date.now()) throw new Refusal(404, 'That invite has expired or was cancelled. Ask for a new one.');
  if (row.email !== user.email)
    throw new Refusal(403, `That invite is for ${row.email}. Sign in with that address to join.`);
  const already = await roleIn(env, row.board_id, userId);
  const now = Date.now();
  if (!already)
    await env.DB.prepare('INSERT INTO members (board_id, user_id, role, added_at) VALUES (?, ?, ?, ?)')
      .bind(row.board_id, userId, row.role, now)
      .run();
  // Also when they're in already: an earlier try may not have reached the board.
  await tellBoard(() => boardStub(env, row!.board_id).setMember(memberRec(user, already ?? row!.role), userId));
  await env.DB.prepare('DELETE FROM invites WHERE id = ?').bind(row.id).run();
  const board = await env.DB.prepare('SELECT id, name, hue FROM boards WHERE id = ?').bind(row.board_id).first<{ id: string; name: string; hue: string }>();
  return { board: board ? { ...board, role: already ?? row.role } : null };
}

export async function declineInvite(env: Env, userId: string, body: { id?: unknown }) {
  const user = await getUser(env, userId);
  if (!user || !isId(body.id)) return;
  await env.DB.prepare('DELETE FROM invites WHERE id = ? AND email = ?').bind(body.id, user.email).run();
}

export async function revokeInvite(env: Env, userId: string, body: { id?: unknown }) {
  if (!isId(body.id)) return;
  const row = await env.DB.prepare('SELECT board_id FROM invites WHERE id = ?').bind(body.id).first<{ board_id: string }>();
  if (!row) return;
  await mustAdmin(env, row.board_id, userId);
  await env.DB.prepare('DELETE FROM invites WHERE id = ?').bind(body.id).run();
}

export async function resendInvite(env: Env, userId: string, body: { id?: unknown }) {
  if (!isId(body.id)) throw new Refusal(404, 'That invite was cancelled.');
  const row = await env.DB.prepare('SELECT * FROM invites WHERE id = ?').bind(body.id).first<InviteRow>();
  if (!row) throw new Refusal(404, 'That invite was cancelled.');
  await mustAdmin(env, row.board_id, userId);
  const token = randomToken(24);
  const now = Date.now();
  await env.DB.prepare('UPDATE invites SET token_hash = ?, created = ?, expires = ? WHERE id = ?')
    .bind(await sha256(token), now, now + INVITE_MS, row.id)
    .run();
  const by = await getUser(env, userId);
  const board = await env.DB.prepare('SELECT name FROM boards WHERE id = ?').bind(row.board_id).first<{ name: string }>();
  if (by && board) await mailInvite(env, row.email, token, board.name, by, row.role);
}
