// A D1 database on node:sqlite with the Worker's migrations applied, for tests of the parts of
// the Worker that only need the directory (link.ts).

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
      db.prepare(query).run(...(args as never[]));
      return {};
    },
  });
  return { db, d1: { prepare: (q: string) => statement(q) } };
}
