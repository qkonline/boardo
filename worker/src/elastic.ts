// The Elastic connection (ARCHITECTURE.md section 5): what Elastic reads and writes, with an
// app token of scope `elastic`. Elastic only ever sees the person's own dated cards, with the
// fields the contract names, and can only start and stop timers and mark their part done.

import type { ElasticCard, ElasticOp } from './board';
import { Refusal } from './auth';
import { boardStub } from './boards';
import { isId } from './checks';
import type { Env } from './env';

const TYPES = ['start', 'stop', 'done', 'undone'];
const MAX_OPS = 200;
/** How far back an op from a device that was offline is still taken. */
const MAX_AGE_MS = 60 * 24 * 3600_000;

export async function elasticCards(env: Env, userId: string): Promise<{ boards: number; cards: ElasticCard[] }> {
  const rows = await env.DB.prepare('SELECT board_id FROM members WHERE user_id = ?').bind(userId).all<{ board_id: string }>();
  const lists = await Promise.all(rows.results.map((r) => boardStub(env, r.board_id).myCards(userId, env.APP_URL)));
  return { boards: rows.results.length, cards: lists.flat() };
}

function op(v: unknown, now: number): ElasticOp | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isId(o.id) || !TYPES.includes(o.type as string) || !isId(o.board) || !isId(o.cardId) || !isId(o.sessionId)) return null;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < now - MAX_AGE_MS || o.at > now + 5 * 60_000) return null;
  return { id: o.id, type: o.type as ElasticOp['type'], board: o.board, cardId: o.cardId, sessionId: o.sessionId, at: Math.min(o.at, now) };
}

/** Apply ops, board by board, in the order given. Every op gets an answer; Elastic drops answered ones. */
export async function elasticOps(env: Env, userId: string, body: { ops?: unknown }) {
  if (!Array.isArray(body.ops) || body.ops.length > MAX_OPS) throw new Refusal(400, 'Bad request');
  const now = Date.now();
  const results: { id: string; ok: boolean; error?: string }[] = [];
  const byBoard = new Map<string, ElasticOp[]>();
  for (const raw of body.ops) {
    const o = op(raw, now);
    if (!o) {
      const id = (raw as { id?: unknown })?.id;
      if (typeof id === 'string') results.push({ id, ok: false, error: 'bad' });
      continue;
    }
    let list = byBoard.get(o.board);
    if (!list) byBoard.set(o.board, (list = []));
    list.push(o);
  }
  for (const [board, ops] of byBoard) {
    const member = await env.DB.prepare('SELECT 1 FROM members WHERE board_id = ? AND user_id = ?').bind(board, userId).first();
    if (!member) {
      for (const o of ops) results.push({ id: o.id, ok: false, error: 'not-member' });
      continue;
    }
    results.push(...(await boardStub(env, board).elasticOps(userId, ops)));
  }
  return { results };
}
