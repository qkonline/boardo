// The bell's store, in D1: each person's updates, which they've read, when they last opened the
// bell (the red count is what came after), and the browsers that want an alert. Boards decide
// who hears what (notes.ts) and hand the updates here; the app reads them with /notes.

import { newId, type Note, type NoteKind } from '../../shared/model';
import { isId } from './checks';
import type { Env } from './env';
import type { Outgoing } from './notes';
import { isPushEndpoint, sendPush } from './push';

/** Updates older than this go. */
const KEEP_MS = 60 * 24 * 3600_000;
const LIST = 50;

/** Store updates from a board. */
export async function saveNotes(env: Env, out: Outgoing[]): Promise<void> {
  for (let i = 0; i < out.length; i += 40)
    await env.DB.batch(
      out.slice(i, i + 40).map(({ userId, note }) => {
        const { board, card, kind, at, ...data } = note;
        return env.DB.prepare('INSERT INTO notes (id, user_id, board_id, card_id, kind, at, data) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
          newId(),
          userId,
          board,
          card,
          kind,
          at,
          JSON.stringify(data),
        );
      }),
    );
}

type Row = { id: string; board_id: string; card_id: string | null; kind: NoteKind; at: number; data: string; read_at: number | null };

/** The person's latest updates, and how many came since they last opened the bell, unread. */
export async function listNotes(env: Env, userId: string): Promise<{ notes: Note[]; unseen: number }> {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM notes WHERE user_id = ? AND at < ?').bind(userId, now - KEEP_MS).run();
  const rows = await env.DB.prepare(
    'SELECT id, board_id, card_id, kind, at, data, read_at FROM notes WHERE user_id = ? ORDER BY at DESC LIMIT ?',
  )
    .bind(userId, LIST)
    .all<Row>();
  const n = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND read_at IS NULL AND at > (SELECT notes_seen FROM users WHERE id = ?)',
  )
    .bind(userId, userId)
    .first<{ n: number }>();
  return {
    notes: rows.results.map((r) => ({
      ...(JSON.parse(r.data) as Omit<Note, 'id' | 'board' | 'card' | 'kind' | 'at' | 'read'>),
      id: r.id,
      board: r.board_id,
      card: r.card_id,
      kind: r.kind,
      at: r.at,
      read: r.read_at != null,
    })),
    unseen: n?.n ?? 0,
  };
}

/** The bell was opened: the red count starts again from now, on every device. */
export async function seenNotes(env: Env, userId: string): Promise<void> {
  await env.DB.prepare('UPDATE users SET notes_seen = ? WHERE id = ?').bind(Date.now(), userId).run();
}

/** Mark these updates read, or all of them. */
export async function readNotes(env: Env, userId: string, body: { ids?: unknown }): Promise<void> {
  const now = Date.now();
  if (body.ids === undefined) {
    await env.DB.prepare('UPDATE notes SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(now, userId).run();
    return;
  }
  if (!Array.isArray(body.ids) || body.ids.length > 90 || !body.ids.every(isId)) return;
  if (!body.ids.length) return;
  await env.DB.prepare(
    `UPDATE notes SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${body.ids.map(() => '?').join(',')})`,
  )
    .bind(now, userId, ...body.ids)
    .run();
}

/** A board was deleted: its updates go too. */
export async function dropBoardNotes(env: Env, boardId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM notes WHERE board_id = ?').bind(boardId).run();
}

// ---------- alerts ----------

/** This browser wants an alert for this person's updates (one person per browser). */
export async function subscribe(env: Env, userId: string, body: { endpoint?: unknown }): Promise<boolean> {
  if (!isPushEndpoint(body.endpoint)) return false;
  await env.DB.prepare('INSERT OR REPLACE INTO push_subs (endpoint, user_id, created) VALUES (?, ?, ?)')
    .bind(body.endpoint, userId, Date.now())
    .run();
  return true;
}

export async function unsubscribe(env: Env, userId: string, body: { endpoint?: unknown }): Promise<void> {
  if (typeof body.endpoint !== 'string') return;
  await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(body.endpoint, userId).run();
}

/** Whether this browser gets alerts for this person. */
export async function subscribed(env: Env, userId: string, body: { endpoint?: unknown }): Promise<boolean> {
  if (typeof body.endpoint !== 'string') return false;
  return !!(await env.DB.prepare('SELECT 1 FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(body.endpoint, userId).first());
}

/** Alert every browser these people turned alerts on in. Browsers that dropped theirs are forgotten. */
export async function alert(env: Env, userIds: string[]): Promise<void> {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY || !userIds.length) return;
  const keys = { VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY, VAPID_SUBJECT: env.VAPID_SUBJECT ?? env.APP_URL };
  const users = [...new Set(userIds)].slice(0, 90);
  const rows = await env.DB.prepare(`SELECT endpoint FROM push_subs WHERE user_id IN (${users.map(() => '?').join(',')})`)
    .bind(...users)
    .all<{ endpoint: string }>();
  await Promise.all(
    rows.results.map(async ({ endpoint }) => {
      const r = await sendPush(endpoint, keys).catch(() => 'failed' as const);
      if (r === 'gone') await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run();
    }),
  );
}
