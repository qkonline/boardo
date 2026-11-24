// IndexedDB. Every board the person is in is kept here, record by record, so the app works
// offline. Next to each record: `synced`, the version last agreed with the board (the base
// for merging), and `outbox`, the records changed here that still have to go out (sync.ts).
// `meta` holds the session, the board list and how far each board has synced.
//
// Every write that changes a record also notes it in the outbox, in the same transaction, so a
// change can't be lost between being saved and being sent.

import type { CardRec, CommentRec, Kind } from '../../shared/model';
import { draftWords, writing, type KeptDraft } from './draft';

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

/**
 * A board this person is no longer in: everything about it goes from this device (R9.7), except
 * copies of their own words that hadn't reached it (R9.5d): comments and texts they wrote, drafts,
 * and copies the board had refused. Returns how many were kept.
 */
export async function dropBoard(board: string): Promise<number> {
  const kept = await ownWords(board);
  if (kept.length) {
    // Kept first: if this can't be stored, the board isn't deleted.
    const old = await getLost();
    await putMeta(LOST, [...old, ...kept].slice(-LOST_KEPT));
  }
  const tx = (await open()).transaction(['records', 'synced', 'outbox', 'meta', 'uploads'], 'readwrite');
  const range = IDBKeyRange.bound(board + '/', board + '/￿');
  tx.objectStore('records').delete(range);
  tx.objectStore('synced').delete(range);
  tx.objectStore('outbox').delete(range);
  tx.objectStore('meta').delete(`rev:${board}`);
  tx.objectStore('meta').delete(`refused:${board}`);
  tx.objectStore('meta').delete(IDBKeyRange.bound(`draft:${board}/`, `draft:${board}/￿`));
  const up = tx.objectStore('uploads');
  up.getAll().onsuccess = (e) => {
    for (const u of (e.target as IDBRequest<{ id: string; board: string }[]>).result) if (u.board === board) up.delete(u.id);
  };
  await txDone(tx);
  return kept.length;
}

/** Copies kept from boards that are gone from this device. */
export type Lost = Refused & { boardName: string };
const LOST = 'lost';
const LOST_KEPT = 200;

export async function getLost(): Promise<Lost[]> {
  return (await getMeta<Lost[]>(LOST)) ?? [];
}

export async function clearLost(): Promise<void> {
  await deleteMeta(LOST);
}

/** This person's own words on a board that only this device has. */
async function ownWords(board: string): Promise<Lost[]> {
  const me = (await getMeta<{ user?: { id: string } }>('session'))?.user?.id;
  const boardName = (await getMeta<{ id: string; name: string }[]>('boards'))?.find((b) => b.id === board)?.name ?? 'A board';
  const at = Date.now();
  const out: Lost[] = [];
  const keep = (id: string, data: object, when = at) => out.push({ id, data, at: when, boardName });
  for (const id of await getOutbox(board)) {
    const kind = splitRid(id)[1];
    const data = await getRecord(id);
    if (!data) continue;
    const was = (await getSynced(id))?.data;
    if (kind === 'card') {
      const c = data as CardRec;
      const b = was as CardRec | null | undefined;
      const desc = [c.desc !== (b?.desc ?? '') ? c.desc : '', ...Object.entries(c.values).filter(([k, v]) => writing(v) && v !== b?.values[k]).map(([, v]) => v)]
        .filter(Boolean)
        .join('\n\n');
      if (!b || c.title !== b.title || desc) keep(id, { title: !b || c.title !== b.title ? c.title : '', desc });
    } else if (kind === 'comment') {
      const c = data as CommentRec;
      if (c.userId === me && !c.deleted && c.text) keep(id, { text: c.text });
    }
  }
  for (const r of await getRefused(board)) {
    const kind = splitRid(r.id)[1];
    if (!r.data) continue;
    if (kind === 'card') keep(r.id, { title: (r.data as CardRec).title, desc: (r.data as CardRec).desc }, r.at);
    if (kind === 'comment') keep(r.id, { text: (r.data as CommentRec).text }, r.at);
  }
  for (const { card, kept } of await getDrafts(board)) for (const w of draftWords(kept)) keep(rid(board, w.kind, card), w.data, kept.at);
  for (const u of await getUploads()) if (u.board === board) keep(rid(board, 'file', u.id), { name: u.name });
  return out;
}

// ---------- unsaved drafts (never sent, only kept) ----------

export async function putDraft(board: string, card: string, d: KeptDraft | null): Promise<void> {
  if (d) await putMeta(`draft:${board}/${card}`, d);
  else await deleteMeta(`draft:${board}/${card}`);
}

export async function getDraft(board: string, card: string): Promise<KeptDraft | undefined> {
  return getMeta(`draft:${board}/${card}`);
}

export async function getDrafts(board?: string): Promise<{ board: string; card: string; kept: KeptDraft }[]> {
  const st = await store('meta', 'readonly');
  const range = IDBKeyRange.bound(`draft:${board ? board + '/' : ''}`, `draft:${board ? board + '/' : ''}￿`);
  const [keys, vals] = await Promise.all([done(st.getAllKeys(range)), done(st.getAll(range))]);
  return keys.map((k, i) => {
    const [b, c] = String(k).slice('draft:'.length).split('/');
    return { board: b, card: c, kept: vals[i] as KeptDraft };
  });
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

/** A change the board refused, as it was here when it was undone. */
export interface Refused {
  id: string;
  data: unknown;
  at: number;
}

const REFUSED_KEPT = 50;

/** Keep copies of changes the board refused (the newest few per board), so none is lost outright. */
export async function keepRefused(board: string, recs: { id: string; data: unknown }[]): Promise<void> {
  const at = Date.now();
  const kept = [...(await getRefused(board)), ...recs.map((r) => ({ ...r, at }))];
  await putMeta(`refused:${board}`, kept.slice(-REFUSED_KEPT));
}

export async function getRefused(board: string): Promise<Refused[]> {
  return (await getMeta<Refused[]>(`refused:${board}`)) ?? [];
}

export async function clearRefused(board: string): Promise<void> {
  await deleteMeta(`refused:${board}`);
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
