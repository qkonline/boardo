// A D1 database on node:sqlite with the Worker's migrations applied, for tests of the parts of
// the Worker that only need the directory (link.ts, boards.ts, auth.ts).

import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../worker/migrations/', import.meta.url));

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(dir + f, 'utf8'));
  const statement = (query: string, args: unknown[] = []) => ({
    bind: (...b: unknown[]) => statement(query, b),
    async first<T>() {
      return ((db.prepare(query).get(...(args as never[])) as T) ?? null) as T | null;
    },
    async all<T>() {
      return {
        results: db
          .prepare(query)
          .all(...(args as never[]))
          .map((r) => ({ ...r })) as T[],
      };
    },
    async run() {
      const r = db.prepare(query).run(...(args as never[]));
      return { meta: { changes: Number(r.changes) } };
    },
  });
  type Statement = ReturnType<typeof statement>;
  const batch = async (list: Statement[]) => {
    const out = [];
    for (const st of list) out.push(await st.run());
    return out;
  };
  return { db, d1: { prepare: (q: string) => statement(q), batch } };
}
