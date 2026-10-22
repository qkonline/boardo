// IndexedDB. Every board the person is in is kept here, record by record, so the app works
// offline. Next to each record: `synced`, the version last agreed with the board (the base
// for merging), and `outbox`, the records changed here that still have to go out (sync.ts).
// `meta` holds the session, the board list and how far each board has synced.
//
// Every write that changes a record also notes it in the outbox, in the same transaction, so a
// change can't be lost between being saved and being sent.

import type { Kind } from '../../shared/model';

const DB_NAME = 'boardo';
const VERSION = 1;

/** A record's id here: board, kind and key. */
export const rid = (board: string, kind: Kind, key: string) => `${board}/${kind}/${key}`;
export function splitRid(id: string): [string, Kind, string] {
  const [board, kind, ...key] = id.split('/');
  return [board, kind as Kind, key.join('/')];
}

export interface Stored {
  id: string;
  board: string;
  kind: Kind;
  key: string;
  data: unknown;
}

export interface Synced {
  rev: number;
  data: unknown;
}

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const recs = db.createObjectStore('records', { keyPath: 'id' });
      recs.createIndex('board', 'board');
      db.createObjectStore('synced');
      db.createObjectStore('outbox');
      db.createObjectStore('meta');
      db.createObjectStore('uploads', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbp = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Boardo is open in another tab that is blocking an upgrade.'));
  });
  dbp.catch(() => (dbp = null));
  return dbp;
}

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const txDone = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });

type StoreName = 'records' | 'synced' | 'outbox' | 'meta' | 'uploads';

async function store(name: StoreName, mode: IDBTransactionMode) {
  return (await open()).transaction(name, mode).objectStore(name);
}

// JSON round-trip strips Svelte state proxies and anything non-cloneable before storing.
const plain = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Every record of one board, or of all of them. */
export async function getRecords(board?: string): Promise<Stored[]> {
  const st = await store('records', 'readonly');
  return done(board ? st.index('board').getAll(board) : st.getAll());
}

export async function getRecord(id: string): Promise<unknown> {
  const r = (await done((await store('records', 'readonly')).get(id))) as Stored | undefined;
  return r?.data ?? null;
}

/** Changes made here: saved and noted for sending. `data` null deletes. */
export async function putLocal(changes: { board: string; kind: Kind; key: string; data: unknown }[]): Promise<void> {
  if (!changes.length) return;
  const tx = (await open()).transaction(['records', 'outbox'], 'readwrite');
  const recs = tx.objectStore('records');
  const outbox = tx.objectStore('outbox');
  for (const c of changes) {
    const id = rid(c.board, c.kind, c.key);
    if (c.data == null) recs.delete(id);
    else recs.put(plain({ id, board: c.board, kind: c.kind, key: c.key, data: c.data } satisfies Stored));
    outbox.put(true, id);
  }
  return txDone(tx);
}

/**
 * Write what came from a board: the local copy (`data` undefined leaves it, null deletes it),
 * the version agreed with the board, and whether it still has changes to send.
 */
export async function putSynced(
  id: string,
  data: unknown,
  synced: Synced,
  dirty: boolean,
): Promise<void> {
  const [board, kind, key] = splitRid(id);
  const tx = (await open()).transaction(['records', 'synced', 'outbox'], 'readwrite');
  const recs = tx.objectStore('records');
  if (data !== undefined) {
    if (data === null) recs.delete(id);
    else recs.put(plain({ id, board, kind, key, data } satisfies Stored));
  }
  tx.objectStore('synced').put(plain(synced), id);
  if (dirty) tx.objectStore('outbox').put(true, id);
  else tx.objectStore('outbox').delete(id);
  return txDone(tx);
}

export async function getSynced(id: string): Promise<Synced | undefined> {
  return done((await store('synced', 'readonly')).get(id));
}

export async function getOutbox(board?: string): Promise<string[]> {
  const ids = (await done((await store('outbox', 'readonly')).getAllKeys())).map(String);
  return board ? ids.filter((id) => id.startsWith(board + '/')) : ids;
}

/** A board this person is no longer in: everything about it goes from this device. */
export async function dropBoard(board: string): Promise<void> {
  const tx = (await open()).transaction(['records', 'synced', 'outbox', 'meta', 'uploads'], 'readwrite');
  const range = IDBKeyRange.bound(board + '/', board + '/￿');
  tx.objectStore('records').delete(range);
  tx.objectStore('synced').delete(range);
  tx.objectStore('outbox').delete(range);
  tx.objectStore('meta').delete(`rev:${board}`);
  const up = tx.objectStore('uploads');
  up.getAll().onsuccess = (e) => {
    for (const u of (e.target as IDBRequest<{ id: string; board: string }[]>).result) if (u.board === board) up.delete(u.id);
  };
  return txDone(tx);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return done((await store('meta', 'readonly')).get(key));
}

export async function putMeta(key: string, v: unknown): Promise<void> {
  await done((await store('meta', 'readwrite')).put(plain(v), key));
}

export async function deleteMeta(key: string): Promise<void> {
  await done((await store('meta', 'readwrite')).delete(key));
}

/** Signing out: nothing about any board stays on the device. */
export async function clearAll(): Promise<void> {
  const tx = (await open()).transaction(['records', 'synced', 'outbox', 'meta', 'uploads'], 'readwrite');
  for (const n of ['records', 'synced', 'outbox', 'meta', 'uploads'] as const) tx.objectStore(n).clear();
  return txDone(tx);
}

// ---------- files waiting to upload (added offline) ----------

export interface Upload {
  id: string;
  board: string;
  card: string;
  name: string;
  type: string;
  blob: Blob;
  thumb: Blob | null;
  at: number;
}

export async function putUpload(u: Upload): Promise<void> {
  await done((await store('uploads', 'readwrite')).put(u));
}

export async function getUploads(): Promise<Upload[]> {
  return done((await store('uploads', 'readonly')).getAll());
}

export async function deleteUpload(id: string): Promise<void> {
  await done((await store('uploads', 'readwrite')).delete(id));
}

/** Close the connection (tests swap in a fresh database between cases). */
export async function closeDb(): Promise<void> {
  if (!dbp) return;
  const db = await dbp.catch(() => null);
  db?.close();
  dbp = null;
}

/** Ask the browser not to evict our data under storage pressure. Best effort. */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}
