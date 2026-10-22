// Keeping this device's copy of each board and the board itself the same.
//
// Every change saved here is noted in the outbox (db.ts) in the same transaction, so nothing is
// lost if the app closes before it goes out. While the app is open, one tab per device (the one
// holding the 'boardo-sync' lock) keeps a WebSocket to each board (worker/src/board.ts): it
// sends what's in that board's outbox, each record with the version it was changed from, and
// takes in what other people change. A change the board refuses because someone else got in
// first comes back with the board's version; the two are merged (merge.ts) and sent again. A
// change the board adjusts (the completion rule, someone else's part) comes back as stored.
// `synced` keeps the version last agreed for each record: the base for those merges.
//
// Other tabs follow the leader over a BroadcastChannel: it tells them which records changed,
// and they tell it when they've saved something to send.

import type { Kind } from '../../shared/model';
import * as db from './db';
import { rid, splitRid } from './db';
import { merge } from './merge';

export type SyncStatus = 'connecting' | 'live' | 'offline';

export interface SyncHooks {
  /** These records changed from the board: reload them. */
  changed(board: string, ids: string[]): void;
  status(board: string, s: SyncStatus): void;
  /** The token was refused (signed out elsewhere, or the account was deleted). */
  signedOut(): void;
  /** This person was removed from the board, or it was deleted. Its data is already gone here. */
  removed(board: string): void;
}

interface Remote {
  kind: Kind;
  key: string;
  rev: number;
  data: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const BACKOFF = [1, 2, 5, 10, 30].map((s) => s * 1000);
const PING_MS = 20_000;
const BATCH = 100;
const BATCH_BYTES = 400_000;

type Msg =
  | { t: 'changed'; board: string; ids: string[] }
  | { t: 'removed'; board: string }
  | { t: 'kick'; board: string }
  | { t: 'status'; board: string; s: SyncStatus };

/** One board's live connection, held by the leading tab. */
class Conn {
  ws: WebSocket | null = null;
  /** The first catch-up after connecting has arrived; sending can start. */
  ready = false;
  inflight: { id: number; sent: Map<string, unknown> } | null = null;
  rev = 0;
  tries = 0;
  retry: ReturnType<typeof setTimeout> | null = null;
  ping: ReturnType<typeof setInterval> | null = null;
  constructor(readonly board: string) {}
}

export class Sync {
  private token: string | null = null;
  private leader = false;
  private release: (() => void) | null = null;
  private conns = new Map<string, Conn>();
  private wanted = new Set<string>();
  private putId = 0;
  private chain: Promise<void> = Promise.resolve();
  private visible = true;
  private channel: BroadcastChannel | null = null;
  private online = () => this.reconnectAll();

  constructor(
    private url: string,
    private hooks: SyncHooks,
  ) {}

  get running(): boolean {
    return !!this.token;
  }

  /** Start syncing these boards: connect if this tab leads, follow the leader otherwise. */
  start(token: string, boards: string[]): void {
    this.token = token;
    this.wanted = new Set(boards);
    this.visible = typeof document === 'undefined' || !document.hidden;
    if (typeof addEventListener === 'function') addEventListener('online', this.online);
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('boardo');
      this.channel.onmessage = (e) => this.heard(e.data as Msg);
    }
    for (const b of boards) this.hooks.status(b, 'connecting');
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks) return this.lead();
    void locks.request('boardo-sync', () => {
      if (!this.token) return;
      this.lead();
      return new Promise<void>((r) => (this.release = r));
    });
  }

  private lead(): void {
    this.leader = true;
    for (const b of this.wanted) this.open(b);
  }

  stop(): void {
    this.token = null;
    this.leader = false;
    this.release?.();
    this.release = null;
    if (typeof removeEventListener === 'function') removeEventListener('online', this.online);
    for (const c of this.conns.values()) this.close(c);
    this.conns.clear();
    this.channel?.close();
    this.channel = null;
  }

  /** The boards to keep in sync changed (joined one, left one). */
  setBoards(boards: string[]): void {
    this.wanted = new Set(boards);
    if (!this.leader) return;
    for (const [b, c] of this.conns) if (!this.wanted.has(b)) (this.close(c), this.conns.delete(b));
    for (const b of boards) if (!this.conns.has(b)) this.open(b);
  }

  private tell(m: Msg): void {
    try {
      this.channel?.postMessage(m);
    } catch {
      /* closed */
    }
  }

  private heard(m: Msg): void {
    if (m.t === 'changed') this.hooks.changed(m.board, m.ids);
    else if (m.t === 'removed') this.hooks.removed(m.board);
    else if (m.t === 'status') this.hooks.status(m.board, m.s);
    else if (m.t === 'kick' && this.leader) this.kick(m.board);
  }

  private setStatus(board: string, s: SyncStatus): void {
    this.hooks.status(board, s);
    this.tell({ t: 'status', board, s });
  }

  private close(c: Conn): void {
    if (c.retry) clearTimeout(c.retry);
    if (c.ping) clearInterval(c.ping);
    c.retry = c.ping = null;
    const ws = c.ws;
    c.ws = null;
    c.ready = false;
    c.inflight = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onopen = null;
      try {
        ws.close(1000);
      } catch {
        /* never opened */
      }
    }
  }

  private open(board: string): void {
    let c = this.conns.get(board);
    if (!c) {
      c = new Conn(board);
      this.conns.set(board, c);
    }
    this.connect(c);
  }

  private connect(c: Conn): void {
    if (!this.token || !this.leader || c.ws || this.conns.get(c.board) !== c) return;
    if (c.retry) clearTimeout(c.retry);
    c.retry = null;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${this.url.replace(/^http/, 'ws')}/sync?board=${encodeURIComponent(c.board)}`, [
        'boardo',
        this.token,
      ]);
    } catch {
      return this.later(c);
    }
    c.ws = ws;
    this.setStatus(c.board, 'connecting');
    ws.onopen = () => {
      this.queue(async () => {
        c.rev = (await db.getMeta<number>(`rev:${c.board}`)) ?? 0;
        this.send(c, { t: 'hello', since: c.rev });
      });
      c.ping = setInterval(() => this.visible && c.ws?.readyState === 1 && c.ws.send('ping'), PING_MS);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.queue(() => this.onMessage(c, m));
    };
    ws.onclose = (e) => {
      if (c.ws !== ws) return;
      c.ws = null;
      c.ready = false;
      c.inflight = null;
      if (c.ping) clearInterval(c.ping);
      c.ping = null;
      if (e.code === 4001) return this.hooks.signedOut();
      if (e.code === 4003) return this.queue(() => this.gone(c.board));
      this.setStatus(c.board, 'offline');
      this.later(c);
    };
  }

  /** Removed from the board, or it was deleted: forget it here. */
  private async gone(board: string): Promise<void> {
    const c = this.conns.get(board);
    if (c) this.close(c);
    this.conns.delete(board);
    this.wanted.delete(board);
    await db.dropBoard(board);
    this.hooks.removed(board);
    this.tell({ t: 'removed', board });
  }

  /** Try again after a pause that grows with each failure. */
  private later(c: Conn): void {
    if (!this.token || !this.leader || c.retry || this.conns.get(c.board) !== c) return;
    const wait = BACKOFF[Math.min(c.tries++, BACKOFF.length - 1)];
    c.retry = setTimeout(() => {
      c.retry = null;
      this.connect(c);
    }, wait);
  }

  private reconnectAll(): void {
    if (!this.token || !this.leader) return;
    for (const c of this.conns.values())
      if (!c.ws) {
        c.tries = 0;
        this.connect(c);
      }
  }

  private send(c: Conn, m: object): boolean {
    if (c.ws?.readyState !== 1) return false;
    c.ws.send(JSON.stringify(m));
    return true;
  }

  /** Messages are handled one at a time, in order (each one reads and writes IndexedDB). */
  private queue(fn: () => Promise<void>): void {
    this.chain = this.chain.then(fn).catch((e) => console.error('Sync', e));
  }

  /** Wait for everything queued so far (tests). */
  settled(): Promise<void> {
    return this.chain;
  }

  private async onMessage(c: Conn, m: Record<string, unknown>): Promise<void> {
    if (m.t === 'signedout') {
      this.close(c);
      return this.hooks.signedOut();
    }
    if (m.t === 'removed') return this.gone(c.board);
    if (m.t === 'changes') {
      const recs = (Array.isArray(m.recs) ? m.recs : []) as Remote[];
      const outbox = new Set(await db.getOutbox(c.board));
      const changed: string[] = [];
      for (const r of recs) {
        if (await this.take(c.board, r, false, outbox)) changed.push(rid(c.board, r.kind, r.key));
        c.rev = Math.max(c.rev, r.rev);
      }
      if (typeof m.rev === 'number' && !m.more) c.rev = Math.max(c.rev, m.rev);
      await db.putMeta(`rev:${c.board}`, c.rev);
      this.announce(c.board, changed);
      if (m.done && !c.ready) {
        c.ready = true;
        c.tries = 0;
        this.setStatus(c.board, 'live');
      }
      return this.sendOutbox(c);
    }
    if (m.t === 'ack' && c.inflight && m.id === c.inflight.id) {
      const { sent } = c.inflight;
      c.inflight = null;
      const changed: string[] = [];
      for (const ok of (m.ok ?? []) as { kind: Kind; key: string; rev: number; data?: unknown }[]) {
        const id = rid(c.board, ok.kind, ok.key);
        const mineSent = sent.get(id);
        const agreed = 'data' in ok ? ok.data : mineSent;
        const now = await db.getRecord(id);
        if (same(now, mineSent)) {
          await db.putSynced(id, 'data' in ok ? agreed : undefined, { rev: ok.rev, data: agreed }, false);
          if ('data' in ok) changed.push(id);
        } else {
          // Changed again here meanwhile: keep that change on top of what the board stored.
          const next = merge(ok.kind, mineSent, now, agreed);
          await db.putSynced(id, next, { rev: ok.rev, data: agreed }, !same(next, agreed));
          if (!same(next, now)) changed.push(id);
        }
        c.rev = Math.max(c.rev, ok.rev);
      }
      for (const r of (m.conflicts ?? []) as Remote[])
        if (await this.take(c.board, r, true, new Set())) changed.push(rid(c.board, r.kind, r.key));
      // Refused (not allowed, or damaged): the board's version stands.
      for (const r of (m.rejected ?? []) as Remote[]) {
        const id = rid(c.board, r.kind, r.key);
        await db.putSynced(id, r.data, { rev: r.rev, data: r.data }, false);
        changed.push(id);
      }
      if (m.error)
        for (const id of sent.keys()) {
          const agreed = (await db.getSynced(id)) ?? { rev: 0, data: null };
          await db.putSynced(id, agreed.data, agreed, false);
          changed.push(id);
        }
      await db.putMeta(`rev:${c.board}`, c.rev);
      this.announce(c.board, changed);
      return this.sendOutbox(c);
    }
  }

  private announce(board: string, ids: string[]): void {
    if (!ids.length) return;
    this.hooks.changed(board, ids);
    this.tell({ t: 'changed', board, ids });
  }

  /**
   * Take in the board's version of a record. Unchanged here: it replaces the local copy.
   * Changed here too: merged, and still to be sent. True if the local copy changed.
   */
  private async take(board: string, r: Remote, conflict: boolean, outbox: Set<string>): Promise<boolean> {
    const id = rid(board, r.kind, r.key);
    const base = await db.getSynced(id);
    if (!conflict && base && base.rev >= r.rev) return false;
    const theirs = r.data ?? null;
    const mine = await db.getRecord(id);
    const dirty = conflict || outbox.has(id);
    const agreed = { rev: r.rev, data: theirs };
    if (same(mine, theirs)) {
      await db.putSynced(id, undefined, agreed, false);
      return false;
    }
    const next = dirty ? merge(r.kind, base?.data ?? null, mine, theirs) : theirs;
    const still = dirty && !same(next, theirs);
    await db.putSynced(id, next, agreed, still);
    return !same(next, mine);
  }

  /** Something was saved here: send it as soon as the board's connection is ready. */
  kick(board: string): void {
    if (!this.leader) return this.tell({ t: 'kick', board });
    const c = this.conns.get(board);
    if (c?.ready) this.queue(() => this.sendOutbox(c));
  }

  private async sendOutbox(c: Conn): Promise<void> {
    if (!c.ready || c.inflight || c.ws?.readyState !== 1) return;
    const ids = await db.getOutbox(c.board);
    if (!ids.length) return;
    const sent = new Map<string, unknown>();
    const recs: object[] = [];
    let bytes = 0;
    for (const id of ids.slice(0, BATCH)) {
      const [, kind, key] = splitRid(id);
      const data = await db.getRecord(id);
      const base = (await db.getSynced(id))?.rev ?? 0;
      // A record made and deleted here before it ever reached the board: nothing to send.
      if (data == null && !base) {
        await db.putSynced(id, undefined, { rev: 0, data: null }, false);
        continue;
      }
      bytes += JSON.stringify(data).length;
      if (recs.length && bytes > BATCH_BYTES) break;
      sent.set(id, data);
      recs.push({ kind, key, base, data });
    }
    if (!recs.length) return;
    c.inflight = { id: ++this.putId, sent };
    if (!this.send(c, { t: 'put', id: this.putId, recs })) c.inflight = null;
  }

  /** The app came to the front or went into the background. */
  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.reconnectAll();
  }
}
