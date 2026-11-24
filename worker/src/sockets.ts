// Closing the connections of sessions that were just ended (signed out, here or from another
// device), on every board the person is in. A connection left open anyway can't change anything:
// the board asks about its session before each change (Board.who()).

import type { Env } from './env';

export async function cutSessions(env: Env, userId: string, hashes: string[]): Promise<void> {
  if (!env.BOARDS || !hashes.length) return;
  const rows = await env.DB.prepare('SELECT board_id FROM members WHERE user_id = ?').bind(userId).all<{ board_id: string }>();
  await Promise.all(
    rows.results.map((r) =>
      env.BOARDS.get(env.BOARDS.idFromName(r.board_id))
        .dropSessions(userId, hashes)
        .catch((e: unknown) => console.error('Closing connections', e)),
    ),
  );
}
