// Moving to another Cloudflare account (Nov 2026). Cloudflare can't copy a Durable Object's storage
// between accounts, so the old deployment hands each object's tables, key-value entries and alarm
// out over /__migrate/dump, and the new one writes them into empty objects over /__migrate/load.
// Both routes are off unless the MIGRATE_KEY secret is set; delete the secret, then this file, once
// the move is done. The same file lives in planner/worker/src/migrate.ts (Elastic).

/** A cell as JSON carries it: blobs go as base64. */
type Cell = string | number | null | { b64: string };

export interface Dump {
  tables: Record<string, Record<string, Cell>[]>;
  entries: [string, unknown][];
  alarm: number | null;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function enc(v: SqlStorageValue): Cell {
  if (v instanceof ArrayBuffer) return { b64: btoa(String.fromCharCode(...new Uint8Array(v))) };
  return v as string | number | null;
}

function dec(v: Cell): SqlStorageValue {
  if (v && typeof v === 'object') return Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0)).buffer;
  return v;
}

/** The object's own tables (not SQLite's, Cloudflare's or the local runtime's), in creation order. */
function tableNames(storage: DurableObjectStorage): string[] {
  return storage.sql
    .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid")
    .toArray()
    .map((r) => String(r.name))
    .filter((n) => !n.startsWith('sqlite_') && !n.startsWith('_cf_') && !n.startsWith('__'));
}

export async function dumpStorage(storage: DurableObjectStorage): Promise<Dump> {
  const tables: Dump['tables'] = {};
  for (const t of tableNames(storage)) {
    if (!NAME.test(t)) throw new Error(`Unexpected table name ${t}`);
    tables[t] = storage.sql
      .exec(`SELECT * FROM "${t}"`)
      .toArray()
      .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, enc(v)])));
  }
  return { tables, entries: [...(await storage.list()).entries()], alarm: await storage.getAlarm() };
}

/** Writes a dump into this object, which must hold nothing yet. Returns the rows written. */
export async function loadStorage(storage: DurableObjectStorage, dump: Dump): Promise<number> {
  for (const t of tableNames(storage)) {
    const n = storage.sql.exec(`SELECT count(*) AS n FROM "${t}"`).one().n;
    if (n) throw new Error(`Refusing to load: table ${t} already has ${n} rows`);
  }
  if ((await storage.list({ limit: 1 })).size) throw new Error('Refusing to load: key-value entries exist');
  let rows = 0;
  storage.transactionSync(() => {
    for (const [t, list] of Object.entries(dump.tables)) {
      if (!NAME.test(t)) throw new Error(`Unexpected table name ${t}`);
      for (const row of list) {
        const cols = Object.keys(row);
        if (!cols.every((c) => NAME.test(c))) throw new Error(`Unexpected column in ${t}`);
        storage.sql.exec(
          `INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          ...cols.map((c) => dec(row[c])),
        );
        rows++;
      }
    }
  });
  if (dump.entries.length) await storage.put(Object.fromEntries(dump.entries));
  if (dump.alarm !== null) await storage.setAlarm(Math.max(dump.alarm, Date.now()));
  return rows;
}

interface Movable {
  migrateDump(): Promise<Dump>;
  migrateLoad(dump: Dump): Promise<number>;
}

async function sameKey(given: string, key: string): Promise<boolean> {
  const h = (s: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [a, b] = await Promise.all([h(given), h(key)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * The two routes, or null for any other path. `names` lists every object to copy (read from D1);
 * `stub` opens one by its name.
 */
export async function migrateRoute(
  req: Request,
  pathname: string,
  key: string | undefined,
  names: () => Promise<string[]>,
  stub: (name: string) => Movable,
): Promise<Response | null> {
  if (!pathname.startsWith('/__migrate/')) return null;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (!key || req.method !== 'POST') return new Response(null, { status: 404 });
  if (!(await sameKey(req.headers.get('x-migrate-key') ?? '', key))) return new Response(null, { status: 404 });
  if (pathname === '/__migrate/dump') {
    const dumps: Record<string, Dump> = {};
    for (const name of await names()) dumps[name] = await stub(name).migrateDump();
    return json(200, { dumps });
  }
  if (pathname === '/__migrate/load') {
    const { dumps } = (await req.json()) as { dumps: Record<string, Dump> };
    const rows: Record<string, number | string> = {};
    for (const [name, dump] of Object.entries(dumps)) {
      try {
        rows[name] = await stub(name).migrateLoad(dump);
      } catch (e) {
        rows[name] = `error: ${(e as Error).message}`;
      }
    }
    return json(200, { rows });
  }
  return new Response(null, { status: 404 });
}
