// Telling Elastic's Worker whose cards changed (see link.ts), so their open devices fetch them.

import type { Env } from './env';

/** The scope of the tokens Elastic's Worker holds for its accounts. */
export const LINK = 'elastic-link';

/** Tell Elastic whose cards may have changed: the Elastic accounts linked to these people. */
export async function notifyElastic(env: Env, users: string[]): Promise<void> {
  if (!env.ELASTIC || !users.length) return;
  try {
    const exts = new Set<string>();
    // D1 takes up to 100 values per query.
    for (let i = 0; i < users.length; i += 90) {
      const part = users.slice(i, i + 90);
      const rows = await env.DB.prepare(
        `SELECT DISTINCT ext FROM app_tokens WHERE scope = ? AND ext IS NOT NULL AND user_id IN (${part.map(() => '?').join(',')})`,
      )
        .bind(LINK, ...part)
        .all<{ ext: string }>();
      for (const r of rows.results) exts.add(r.ext);
    }
    if (exts.size) await env.ELASTIC.cardsChanged([...exts]);
  } catch (e) {
    console.error('Telling Elastic', e);
  }
}

/**
 * These Elastic accounts' links were revoked here (taken off in Connected apps, or the Boardo
 * account deleted). Elastic's devices fetch again at once, find the link gone and drop Projects
 * everywhere (R8.4), as when it's disconnected from Elastic's side.
 */
export async function linksGone(env: Env, exts: string[]): Promise<void> {
  if (!env.ELASTIC || !exts.length) return;
  try {
    await env.ELASTIC.cardsChanged(exts);
  } catch (e) {
    console.error('Telling Elastic', e);
  }
}
