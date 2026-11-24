// Nightly copies of every board's text, in their own R2 bucket, each deleted after 14 days by the
// bucket's lifecycle rule. Attachments and photos aren't copied. Each board writes its own copy
// (Board.backUp), so a big one never passes through here.

import { boardStub } from './boards';
import type { Env } from './env';

const AT_ONCE = 5;
/** Calls one night's run may make, under the free plan's 1,000. */
const MOST = 900;

/** Where a board's copy for a day is kept. */
export const backupKey = (board: string, at: number) => `${new Date(at).toISOString().slice(0, 10)}/${board}.jsonl`;

/** Copy every board. One that fails is logged, and the rest go on. */
export async function backUp(env: Env, at: number): Promise<{ kept: number; failed: number }> {
  if (!env.BACKUPS) return { kept: 0, failed: 0 };
  const { results } = await env.DB.prepare('SELECT id FROM boards ORDER BY id').all<{ id: string }>();
  let kept = 0;
  let failed = 0;
  if (results.length > MOST) console.error(`Backup: ${results.length - MOST} boards left out, over ${MOST}`);
  const ids = results.slice(0, MOST).map((r) => r.id);
  for (let i = 0; i < ids.length; i += AT_ONCE)
    await Promise.all(
      ids.slice(i, i + AT_ONCE).map(async (id) => {
        try {
          if (!(await boardStub(env, id).backUp(backupKey(id, at)))) throw new Error('The board is empty');
          kept++;
        } catch (e) {
          failed++;
          console.error('Backup', id, e);
        }
      }),
    );
  console.log(`Backup: ${kept} boards kept, ${failed} failed`);
  return { kept, failed };
}
