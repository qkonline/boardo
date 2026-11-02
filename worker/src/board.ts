// One per board: everything in it (columns, cards, fields, comments, files, time and the log),
// kept as versioned records, plus the live connections of the people looking at it.
//
// Each member's device keeps a WebSocket open per board while the app is open. It sends the
// records it changed, each with the version it was changed from (`base`); a change made on an
// older version than the board's comes back as a conflict, with the current one, and the device
// merges and tries again (src/lib/merge.ts). Every change gets the next number in one sequence
// (`rev`), so a device coming back asks for everything after the last number it saw.
//
// The board, not the device, enforces the rules: who may write what (members can't touch the
// board or its fields; nobody writes members, files, time or the log), each person's part of a
// card, the completion rule (shared/rules.ts), and the log, which it writes itself by comparing
// each accepted change with what was there before.
//
// The Worker checks the directory (D1) before handing a connection over, and passes who it is
// in the `x-user` and `x-role` headers. It also tells the board when people join, leave or
// change role, so the `member` records and open connections follow. The board doesn't take the
// headers' word alone: someone not in its own member list is turned away, a role is never more
// than its member record says, and each put asks the directory again, so a connection left open
// by a removal the board wasn't told of closes at the next change it sends.
//
// What one board keeps is capped (records, bytes, Elastic's op ids), and so is how fast one
// person can change it and how many updates their changes can send.

import { DurableObject } from 'cloudflare:workers';
import {
  ADMIN_KINDS,
  BOARD_FILE,
  type BoardRec,
  type CardRec,
  type ColumnRec,
  type CommentRec,
  DEFAULT_FIELDS,
  type FieldRec,
  type FileRec,
  type Kind,
  type LogAction,
  type LogRec,
  type MemberRec,
  newId,
  type Role,
  type SessionRec,
} from '../../shared/model';
import { cardChanges, type LogEntry, optionWithRole, sameNamed, settle, statusAsPart, withNewCardDefaults } from '../../shared/rules';
import { type Change, changes } from './checks';
import type { Env } from './env';
import { alert, saveNotes } from './inbox';
import { cardNotes, commentNotes, memberNote, type NoteCtx, type Outgoing } from './notes';
import { notifyElastic } from './notify';

/** A record as it goes out to devices. `data` null: deleted. */
export interface Rec {
  kind: Kind;
  key: string;
  rev: number;
  data: unknown;
}

/** A card as Elastic receives it (the contract: ARCHITECTURE.md section 5.2). */
export interface ElasticCard {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  hasTime: boolean;
  board: { id: string; name: string; hue: string };
  status: { label: string | null; role: string | null };
  /** When this person's part was done (ms), or null. */
  myDone: number | null;
  completed: boolean;
  completedAt: number | null;
  url: string;
}

/** A timer or done mark from Elastic. */
export interface ElasticOp {
  id: string;
  type: 'start' | 'stop' | 'done' | 'undone';
  board: string;
  cardId: string;
  sessionId: string;
  at: number;
}

/** What each WebSocket remembers across the object sleeping. */
interface Attachment {
  userId: string;
  role: Role;
}

/** The records whose changes can change what Elastic shows. */
const SHOWN_IN_ELASTIC = new Set<Kind>(['card', 'board', 'field', 'member']);
/** Big first syncs go out in pieces of about this size. */
const CHUNK = 400_000;
/** What a board keeps at most: rows (records, log entries included, and Elastic's op ids) and their bytes. */
const MAX_RECORDS = 100_000;
const MAX_BYTES = 20 * 1024 * 1024;
/** What a row costs beyond its data, roughly (its kind, key, rev and index entries). */
const ROW_BYTES = 64;
/** Elastic's op ids are kept this long; an op older than 60 days is refused anyway (elastic.ts). */
const OPS_KEEP_MS = 62 * 24 * 3600_000;
/** Puts in a minute: per connection, and per person over all their connections and requests. */
const PUTS_PER_SOCKET = 120;
const PUTS_PER_USER = 240;
/** Updates (the bell) one person's changes can make in a minute, and times they can alert phones. */
const NOTES_PER_ACTOR = 30;
const ALERTS_PER_ACTOR = 10;
const MINUTE = 60_000;
/** Edits to the same field of a card by the same person this close together log as one. */
const COALESCE_MS = 10 * 60_000;
const COALESCED: LogAction[] = ['renamed', 'described', 'changed'];

/** What a `put` came to: per record, kept (with what was stored when it differs), conflicting or refused. */
interface PutResult {
  ok: { kind: Kind; key: string; rev: number; data?: unknown }[];
  conflicts: Rec[];
  rejected: Rec[];
  /** Everything that changed, for the other devices. */
  changed: Rec[];
  /** Changes the sender doesn't have yet either: log entries and automatic updates. */
  extra: Rec[];
}

export class Board extends DurableObject<Env> {
  private sql: SqlStorage;
  /** Rows and bytes kept, read once from kv `usage` and written back with each transaction (tx()). */
  private usage: { rows: number; bytes: number } | null = null;
  private usageChanged = false;
  /** Counts in the current minute, for the limits above (kept in memory: they start again when the board sleeps). */
  private rates = new Map<string, { start: number; n: number }>();
  private socketRates = new WeakMap<WebSocket, { start: number; n: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, key TEXT NOT NULL, rev INTEGER NOT NULL, data TEXT,
        PRIMARY KEY (kind, key));
      CREATE INDEX IF NOT EXISTS records_rev ON records (rev);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ops (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
    `);
    // Keep-alives are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ---------- connections ----------

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade') !== 'websocket') return new Response(null, { status: 426 });
    const userId = req.headers.get('x-user');
    const role = req.headers.get('x-role');
    if (!userId || (role !== 'admin' && role !== 'member')) return new Response(null, { status: 403 });
    const [client, server] = Object.values(new WebSocketPair());
    const me = this.get('member', userId);
    if (!me) {
      // Not in this board's own list: told so, as the Worker tells a non-member.
      server.accept();
      server.send(JSON.stringify({ t: 'removed' }));
      server.close(4003, 'Not in this board');
    } else {
      this.ctx.acceptWebSocket(server, [userId]);
      server.serializeAttachment({ userId, role: lesser(role, me.role) } satisfies Attachment);
    }
    return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'boardo' } });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === 'put' && !this.within(this.socketRates, ws, PUTS_PER_SOCKET)) {
      // Too fast: the device reconnects after a pause and sends what's waiting again.
      ws.close(1013, 'Slow down');
      return;
    }
    const out = await this.answer(m, ws.deserializeAttachment() as Attachment, ws);
    if (!out) return ws.close(1013, 'Slow down');
    for (const o of out) ws.send(JSON.stringify(o));
  }

  /**
   * The same conversation for a device whose network lets ordinary requests through but not
   * WebSockets: one message in, the replies back. It asks for changes every few seconds. Null:
   * too many changes too fast (the Worker answers 429, and the device tries again later).
   */
  async httpSync(userId: string, role: Role, m: Record<string, unknown>): Promise<object[] | null> {
    return this.answer(m, { userId, role }, null);
  }

  /** The replies to one message from a device: changes since a point, or a put's ack. */
  private async answer(m: Record<string, unknown>, att: Attachment, from: WebSocket | null): Promise<object[] | null> {
    const who = await this.who(att, m.t === 'put');
    if (!who) {
      if (from) from.close(4003, 'Removed from board');
      return [{ t: 'removed' }];
    }
    if (m.t === 'hello') return this.since(Number.isInteger(m.since) ? (m.since as number) : 0);
    if (m.t !== 'put') return [];
    if (!this.within(this.rates, `puts:${who.userId}`, PUTS_PER_USER)) return null;
    const res = this.put(m.recs, who);
    if (!res) return [{ t: 'ack', id: m.id, ok: [], conflicts: [], rejected: [], error: 'bad' }];
    const out: object[] = [{ t: 'ack', id: m.id, ok: res.ok, conflicts: res.conflicts, rejected: res.rejected, rev: this.rev() }];
    if (res.extra.length) out.push({ t: 'changes', recs: res.extra, rev: this.rev() });
    if (res.changed.length) this.broadcast(res.changed, from);
    this.sendNotes(who.userId);
    return out;
  }

  /**
   * Who a message is from, as this board sees it: someone in its member list, with a role no
   * more than their member record's. Before a change (`ask`), the directory is asked too, so
   * someone removed there while this board wasn't told can't change anything.
   */
  private async who(att: Attachment, ask: boolean): Promise<Attachment | null> {
    const me = this.get('member', att.userId);
    if (!me) return null;
    let role = lesser(att.role, me.role);
    const id = this.boardId();
    if (ask && id) {
      try {
        const row = await this.env.DB.prepare('SELECT role FROM members WHERE board_id = ? AND user_id = ?')
          .bind(id, att.userId)
          .first<{ role: Role }>();
        if (!row) return null;
        role = lesser(role, row.role);
      } catch (e) {
        // The directory can't be reached: the board's own list stands.
        console.error('Checking membership', e);
      }
    }
    return { userId: att.userId, role };
  }

  /** Count one more in this minute for `key`; false once that's over `max`. */
  private within<K>(map: { get(k: K): { start: number; n: number } | undefined; set(k: K, v: { start: number; n: number }): unknown }, key: K, max: number, add = 1): boolean {
    const now = Date.now();
    let r = map.get(key);
    if (!r || now - r.start > MINUTE) map.set(key, (r = { start: now, n: 0 }));
    r.n += add;
    return r.n <= max;
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'Closed');
    } catch {
      /* already closed */
    }
  }

  /** Everything after `since`, oldest first, in pieces; the last piece says how far that got. */
  private since(since: number): object[] {
    const out: object[] = [];
    const rev = this.rev();
    // A device that's ahead of the board (it was reset) starts again from the beginning.
    const from = since > rev ? 0 : since;
    let recs: Rec[] = [];
    let size = 0;
    for (const r of this.sql.exec<{ kind: Kind; key: string; rev: number; data: string | null }>(
      'SELECT kind, key, rev, data FROM records WHERE rev > ? ORDER BY rev',
      from,
    )) {
      recs.push({ kind: r.kind, key: r.key, rev: r.rev, data: r.data == null ? null : JSON.parse(r.data) });
      size += (r.data?.length ?? 0) + 100;
      if (size > CHUNK) {
        out.push({ t: 'changes', recs, more: true });
        recs = [];
        size = 0;
      }
    }
    out.push({ t: 'changes', recs, rev, done: true, reset: from === 0 && since > 0 });
    return out;
  }

  private broadcast(recs: Rec[], except: WebSocket | null): void {
    if (!recs.length) return;
    this.tellElastic(recs);
    const msg = JSON.stringify({ t: 'changes', recs, rev: this.rev() });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(msg);
      } catch {
        /* gone; it will catch up when it reconnects */
      }
    }
  }

  /**
   * Something Elastic shows may have changed (a card, a status, the board's name or colour, who's
   * in it): tell Elastic, for everyone in the board and anyone just taken out of it.
   */
  private tellElastic(recs: Rec[]): void {
    if (!this.env.ELASTIC || !recs.some((r) => SHOWN_IN_ELASTIC.has(r.kind))) return;
    const users = new Set(this.all('member').map((m) => m.userId));
    for (const r of recs) if (r.kind === 'member') users.add(r.key);
    this.ctx.waitUntil(notifyElastic(this.env, [...users]));
  }

  // ---------- the bell ----------

  /** Updates from the changes being made, sent once they're stored (sendNotes()). */
  private notes: Outgoing[] = [];

  /** Updates one person's change makes, up to how many they may make in a minute. */
  private note(actor: string | null, list: Outgoing[]): void {
    if (!list.length) return;
    if (actor && !this.within(this.rates, `notes:${actor}`, NOTES_PER_ACTOR, list.length)) return;
    this.notes.push(...list);
  }

  private noteCtx(actor: string | null, now: number): NoteCtx {
    const b = this.get('board', 'main');
    return {
      board: { id: this.boardId() ?? '', name: b?.name ?? '', hue: b?.hue ?? 'slate' },
      members: new Map(this.all('member').map((m) => [m.userId, m])),
      status: this.get('field', 'status') ?? undefined,
      cards: () => this.all('card'),
      actor,
      now,
    };
  }

  /**
   * Store the updates the last changes made (inbox.ts), tell the open devices of the people they're
   * for, which then fetch them, and alert the browsers those people turned alerts on in.
   */
  private sendNotes(actor: string | null = null): void {
    const out = this.notes;
    this.notes = [];
    if (!out.length) return;
    // Phones are alerted a few times a minute at most for one person's changes; the bell still has them all.
    const push = !actor || this.within(this.rates, `alerts:${actor}`, ALERTS_PER_ACTOR);
    this.ctx.waitUntil(
      (async () => {
        try {
          await saveNotes(this.env, out);
          const users = [...new Set(out.map((o) => o.userId))];
          for (const u of users)
            for (const ws of this.ctx.getWebSockets(u))
              try {
                ws.send('{"t":"note"}');
              } catch {
                /* gone */
              }
          if (push) await alert(this.env, users);
        } catch (e) {
          console.error('Updates', e);
        }
      })(),
    );
  }

  // ---------- records ----------

  private rev(): number {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM kv WHERE k = 'rev'").toArray()[0];
    return row ? Number(row.v) : 0;
  }

  private current(kind: Kind, key: string): { rev: number; data: unknown; size: number } | null {
    const row = this.sql
      .exec<{ rev: number; data: string | null }>('SELECT rev, data FROM records WHERE kind = ? AND key = ?', kind, key)
      .toArray()[0];
    return row ? { rev: row.rev, data: row.data == null ? null : JSON.parse(row.data), size: row.data?.length ?? 0 } : null;
  }

  private get<K extends Kind>(kind: K, key: string) {
    return (this.current(kind, key)?.data ?? null) as KindOf<K> | null;
  }

  private all<K extends Kind>(kind: K): KindOf<K>[] {
    return this.sql
      .exec<{ data: string }>('SELECT data FROM records WHERE kind = ? AND data IS NOT NULL', kind)
      .toArray()
      .map((r) => JSON.parse(r.data));
  }

  /** Store a record under the next rev. Call inside a transaction (tx()); returns it as sent out. */
  private write(kind: Kind, key: string, data: unknown): Rec {
    const rev = this.rev() + 1;
    const json = data == null ? null : JSON.stringify(data);
    const old = this.sql
      .exec<{ n: number | null }>('SELECT LENGTH(data) AS n FROM records WHERE kind = ? AND key = ?', kind, key)
      .toArray()[0];
    this.used(old ? 0 : 1, (json?.length ?? 0) - (old?.n ?? 0));
    this.sql.exec(
      'INSERT INTO records (kind, key, rev, data) VALUES (?, ?, ?, ?) ON CONFLICT (kind, key) DO UPDATE SET rev = excluded.rev, data = excluded.data',
      kind,
      key,
      rev,
      json,
    );
    this.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('rev', ?)", String(rev));
    return { kind, key, rev, data: data ?? null };
  }

  // ---------- what the board keeps ----------

  /** Rows and bytes kept. Worked out once from the tables, then kept up to date as they change. */
  private use(): { rows: number; bytes: number } {
    if (this.usage) return this.usage;
    const kept = this.sql.exec<{ v: string }>("SELECT v FROM kv WHERE k = 'usage'").toArray()[0];
    if (kept) return (this.usage = JSON.parse(kept.v));
    const r = this.sql.exec<{ n: number; b: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS b FROM records').one();
    const o = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM ops').one();
    this.usageChanged = true;
    return (this.usage = { rows: r.n + o.n, bytes: r.b + (r.n + o.n) * ROW_BYTES });
  }

  private used(rows: number, bytes: number): void {
    const u = this.use();
    u.rows += rows;
    u.bytes += bytes + rows * ROW_BYTES;
    this.usageChanged = true;
  }

  /** Whether the board has room for a change that adds `bytes` (and a new row, if `isNew`). */
  private room(bytes: number, isNew: boolean): boolean {
    const grow = bytes + (isNew ? ROW_BYTES : 0);
    if (grow <= 0) return true;
    const u = this.use();
    return u.bytes + grow <= MAX_BYTES && (!isNew || u.rows < MAX_RECORDS);
  }

  /** A transaction that also keeps the board's usage. */
  private tx(fn: () => void): void {
    try {
      this.ctx.storage.transactionSync(() => {
        fn();
        if (this.usageChanged && this.usage)
          this.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('usage', ?)", JSON.stringify(this.usage));
        this.usageChanged = false;
      });
    } catch (e) {
      // Rolled back: read it again next time.
      this.usage = null;
      this.usageChanged = false;
      throw e;
    }
  }

  /**
   * Add to the log. An edit to the same text or field of a card by the same person shortly
   * after the last one updates that entry instead, so typing doesn't fill the log.
   */
  private log(cardId: string | null, userId: string | null, e: LogEntry, now: number): Rec {
    if (COALESCED.includes(e.action) && cardId) {
      const last = this.sql
        .exec<{ key: string; data: string }>("SELECT key, data FROM records WHERE kind = 'log' ORDER BY rev DESC LIMIT 1")
        .toArray()[0];
      const prev = last ? (JSON.parse(last.data) as LogRec) : null;
      if (
        prev &&
        prev.cardId === cardId &&
        prev.userId === userId &&
        prev.action === e.action &&
        prev.detail.field === (e.detail.field ?? undefined) &&
        now - prev.at < COALESCE_MS
      ) {
        const detail: LogEntry['detail'] = { ...e.detail, from: prev.detail.from ?? null };
        if (e.action === 'renamed' && detail.from === detail.to) {
          return this.write('log', prev.id, null);
        }
        return this.write('log', prev.id, { ...prev, at: now, detail } satisfies LogRec);
      }
    }
    const id = newId();
    return this.write('log', id, { id, cardId, userId, at: now, action: e.action, detail: e.detail } satisfies LogRec);
  }

  /**
   * Apply changes from a device. Each one made on the record's current version, and allowed
   * for this person, is kept under the next rev (possibly adjusted: someone else's part of a
   * card is never theirs to change); any made on an older version comes back as a conflict.
   */
  private put(raw: unknown, who: Attachment): PutResult | null {
    const parsed = changes(raw);
    if (!parsed) return null;
    const res: PutResult = { ok: [], conflicts: [], rejected: [], changed: [], extra: [] };
    const now = Date.now();
    const asNow = (kind: Kind, key: string): Rec => {
      const cur = this.current(kind, key);
      return { kind, key, rev: cur?.rev ?? 0, data: cur?.data ?? null };
    };
    for (const c of parsed.bad) res.rejected.push(asNow(c.kind, c.key));

    // Cards made in this same put are there for the comments on them, whatever the order.
    const incoming = new Set(parsed.list.filter((c) => c.kind === 'card' && c.data).map((c) => c.key));
    let nctx: NoteCtx | null = null;
    const noteCtx = () => (nctx ??= this.noteCtx(who.userId, now));

    this.tx(() => {
      const cards = new Set<string>();
      const goneColumns = new Set<string>();
      for (const c of parsed.list) {
        const cur = this.current(c.kind, c.key);
        if ((cur?.rev ?? 0) !== c.base) {
          res.conflicts.push({ kind: c.kind, key: c.key, rev: cur?.rev ?? 0, data: cur?.data ?? null });
          continue;
        }
        const prev = cur?.data ?? null;
        let data = this.allowed(c, prev, who, now);
        // A new comment needs its card (it may have been deleted for good meanwhile).
        if (c.kind === 'comment' && !prev && data) {
          const cardId = (data as CommentRec).cardId;
          if (!this.get('card', cardId) && !incoming.has(cardId)) data = undefined;
        }
        // A full board takes only changes that make nothing bigger (refused one at a time, as any refusal).
        if (data === undefined || !this.room((data == null ? 0 : JSON.stringify(data).length) - (cur?.size ?? 0), !cur)) {
          res.rejected.push(asNow(c.kind, c.key));
          continue;
        }
        const logs = this.logsFor(c.kind, prev, data, who.userId, now);
        const rec = this.write(c.kind, c.key, data);
        if (c.kind === 'card') {
          cards.add(c.key);
          this.note(who.userId, cardNotes(prev as CardRec | null, data as CardRec, noteCtx()));
        }
        if (c.kind === 'comment') {
          const cm = (data ?? prev) as CommentRec;
          this.note(who.userId, commentNotes(prev as CommentRec | null, data as CommentRec | null, this.get('card', cm.cardId), noteCtx()));
        }
        if (c.kind === 'column' && prev && !data) goneColumns.add(c.key);
        const adjusted = JSON.stringify(data) !== JSON.stringify(c.data);
        res.ok.push(adjusted ? { kind: c.kind, key: c.key, rev: rec.rev, data } : { kind: c.kind, key: c.key, rev: rec.rev });
        res.changed.push(rec);
        for (const l of logs) {
          const r = this.log(l.cardId, l.userId, l.entry, now);
          res.changed.push(r);
          res.extra.push(r);
        }
        if (c.kind === 'board' && data) {
          this.mirrorBoard(data as BoardRec);
          for (const r of this.sweepBackgrounds(data as BoardRec)) {
            res.changed.push(r);
            res.extra.push(r);
          }
        }
      }
      for (const r of this.rehome(cards, goneColumns, who.userId, now)) {
        res.changed.push(r);
        res.extra.push(r);
      }
    });
    return res;
  }

  /**
   * Cards whose column isn't there (added to it on a device that was offline while someone
   * removed it, or left in it when it was removed) go to the end of the first column, so none
   * goes missing. Call inside a transaction.
   */
  private rehome(written: Set<string>, goneColumns: Set<string>, userId: string, now: number): Rec[] {
    if (!written.size && !goneColumns.size) return [];
    const columns = this.all('column').sort((a, b) => a.order - b.order);
    if (!columns.length) return [];
    const live = new Set(columns.map((c) => c.id));
    // Only the cards just written and those in a column just removed are read, not every card.
    const lost: CardRec[] = [];
    for (const id of written) {
      const c = this.get('card', id);
      if (c && !live.has(c.columnId)) lost.push(c);
    }
    for (const col of goneColumns) for (const c of this.cardsIn(col)) if (!written.has(c.id) && !live.has(c.columnId)) lost.push(c);
    if (!lost.length) return [];
    const to = columns[0].id;
    let order = Math.max(0, ...this.cardsIn(to).map((c) => c.order));
    const out: Rec[] = [];
    for (const card of lost) {
      const next = { ...card, columnId: to, order: (order += 1) };
      const logs = this.logsFor('card', card, next, userId, now);
      out.push(this.write('card', card.id, next));
      for (const l of logs) out.push(this.log(l.cardId, l.userId, l.entry, now));
    }
    return out;
  }

  /** The cards in one column. */
  private cardsIn(columnId: string): CardRec[] {
    return this.sql
      .exec<{ data: string }>(
        "SELECT data FROM records WHERE kind = 'card' AND data IS NOT NULL AND json_extract(data, '$.columnId') = ?",
        columnId,
      )
      .toArray()
      .map((r) => JSON.parse(r.data));
  }

  /**
   * The record to store for a change, or undefined if this person may not make it. Cards get
   * the completion rule and keep everyone else's parts as they were.
   */
  private allowed(c: Change, prev: unknown, who: Attachment, now: number): unknown {
    const admin = who.role === 'admin';
    if (ADMIN_KINDS.includes(c.kind) && !admin) return undefined;
    switch (c.kind) {
      case 'board': {
        // A board is deleted through the Worker, never as a record. A new background image must be
        // one uploaded to this board first (addBackground); anything else keeps the old background.
        const next = c.data as BoardRec | null;
        if (!next) return undefined;
        const before = prev as BoardRec | null;
        const img = next.background && 'image' in next.background ? next.background.image : null;
        const had = before?.background && 'image' in before.background ? before.background.image : null;
        if (img && img !== had && this.get('file', img)?.cardId !== BOARD_FILE) return { ...next, background: before?.background ?? null };
        return next;
      }
      case 'column': {
        // No two columns with one name (from a device that didn't know of the other yet). Only a new
        // or changed name is checked, so a board that has two already can still move them.
        const next = c.data as ColumnRec | null;
        const named = next && (prev as ColumnRec | null)?.name !== next.name;
        if (named && sameNamed(this.all('column'), next.name, c.key)) return undefined;
        return next;
      }
      case 'field': {
        const before = prev as FieldRec | null;
        const next = c.data as FieldRec | null;
        if (before?.builtin) {
          if (!next || next.builtin !== before.builtin) return undefined;
          if (next.builtin === 'status') {
            if (next.type !== 'dropdown') return undefined;
            // The two values automation relies on can be renamed, never removed.
            for (const role of ['in_progress', 'completed'] as const)
              if (!next.options?.some((o) => o.role === role)) return undefined;
            if ((next.options ?? []).filter((o) => o.role).length !== 2) return undefined;
          } else if (next.type !== 'date' && next.type !== 'datetime') return undefined;
          return next;
        }
        if (next?.builtin) return undefined;
        if (next?.options?.some((o) => o.role)) return { ...next, options: next.options.map(({ role: _, ...o }) => o) };
        if (next && !before && this.all('field').length >= 40) return undefined;
        return next;
      }
      case 'card': {
        const before = prev as CardRec | null;
        let next = c.data as CardRec | null;
        if (!next) return undefined; // deleted only through deleteCard(), once archived
        if (!before && next.createdBy !== who.userId) next = { ...next, createdBy: who.userId };
        if (!before && Math.abs(next.created - now) > 7 * 24 * 3600_000) next = { ...next, created: now };
        if (before) next = { ...next, createdBy: before.createdBy, created: before.created };
        // Completed picked by hand is the person's own Mark done; moving off it, their Mark not done.
        next = statusAsPart(before, next, who.userId, this.get('field', 'status') ?? undefined, now);
        // Only members can be assigned.
        const members = new Set(this.all('member').map((m) => m.userId));
        // A new card starts with the board's defaults, from devices that didn't put them in yet.
        if (!before) next = withNewCardDefaults(next, this.get('board', 'main'), members, this.get('field', 'status') ?? undefined);
        const assignees = next.assignees.filter((u) => members.has(u) || before?.assignees.includes(u));
        // Each person marks their own part; everyone else's stays as it was, except that an admin
        // can take someone's done mark off (never put one on for them).
        const done: Record<string, number> = {};
        for (const [u, at] of Object.entries(before?.done ?? {})) if (u !== who.userId && !(admin && next.done[u] == null)) done[u] = at;
        if (next.done[who.userId] != null) done[who.userId] = before?.done[who.userId] ?? Math.min(next.done[who.userId], now);
        next = { ...next, assignees, done };
        return settle(before, next, this.get('field', 'status') ?? undefined).card;
      }
      case 'comment': {
        const before = prev as CommentRec | null;
        const next = c.data as CommentRec | null;
        // A comment is only ever changed by the person who wrote it.
        if (before && before.userId !== who.userId) return undefined;
        if (!next) return before ? null : undefined;
        if (next.userId !== who.userId) return undefined;
        if (!before) return { ...next, at: Math.min(next.at, now), editedAt: undefined, deleted: undefined };
        return { ...next, at: before.at, cardId: before.cardId, editedAt: next.deleted ? before.editedAt : now };
      }
    }
    return undefined;
  }

  /** The log entries for an accepted change. */
  private logsFor(
    kind: Kind,
    prev: unknown,
    next: unknown,
    userId: string,
    now: number,
  ): { cardId: string | null; userId: string | null; entry: LogEntry }[] {
    if (kind === 'card') {
      const before = prev as CardRec | null;
      const after = next as CardRec;
      const fields = new Map(this.all('field').map((f) => [f.id, f]));
      const columns = new Map(this.all('column').map((c) => [c.id, c.name]));
      // The status the device asked for, before the completion rule, logs as theirs; a change
      // the rule made logs as automatic.
      const asked = before ? cardChanges(before, after, fields, columns) : cardChanges(null, after, fields, columns);
      const status = fields.get('status');
      const out: { cardId: string | null; userId: string | null; entry: LogEntry }[] = [];
      for (const entry of asked) {
        if (entry.action === 'status' && before) {
          const wanted = before && this.autoStatus(before, after, status);
          if (wanted) {
            out.push({ cardId: after.id, userId: null, entry: { ...entry, detail: { ...entry.detail, auto: true } } });
            continue;
          }
        }
        out.push({ cardId: after.id, userId, entry });
      }
      return out;
    }
    if (kind === 'comment') {
      const before = prev as CommentRec | null;
      const after = next as CommentRec | null;
      if (!before && after) return [{ cardId: after.cardId, userId, entry: { action: 'commented', detail: { comment: after.id } } }];
      return [];
    }
    if (kind === 'column') {
      const before = prev as ColumnRec | null;
      const after = next as ColumnRec | null;
      if (!before && after) return [{ cardId: null, userId, entry: { action: 'column_added', detail: { name: after.name } } }];
      if (before && !after) return [{ cardId: null, userId, entry: { action: 'column_removed', detail: { name: before.name } } }];
      if (before && after && before.name !== after.name)
        return [{ cardId: null, userId, entry: { action: 'column_renamed', detail: { from: before.name, to: after.name } } }];
      return [];
    }
    if (kind === 'field') {
      const before = prev as FieldRec | null;
      const after = next as FieldRec | null;
      if (!before && after) return [{ cardId: null, userId, entry: { action: 'field_added', detail: { name: after.name } } }];
      if (before && !after) return [{ cardId: null, userId, entry: { action: 'field_removed', detail: { name: before.name } } }];
      if (before && after && JSON.stringify({ ...before, order: 0 }) !== JSON.stringify({ ...after, order: 0 }))
        return [{ cardId: null, userId, entry: { action: 'field_changed', detail: { name: after.name, from: before.name } } }];
      return [];
    }
    if (kind === 'board') {
      const before = prev as BoardRec | null;
      const after = next as BoardRec;
      const out: { cardId: string | null; userId: string | null; entry: LogEntry }[] = [];
      if (before && before.name !== after.name)
        out.push({ cardId: null, userId, entry: { action: 'board_renamed', detail: { from: before.name, to: after.name } } });
      if (before && JSON.stringify(before.background ?? null) !== JSON.stringify(after.background ?? null))
        out.push({ cardId: null, userId, entry: { action: 'background_changed', detail: { to: bgKind(after) } } });
      return out;
    }
    void now;
    return [];
  }

  /** Whether the completion rule (not the person) moved this card's status. */
  private autoStatus(before: CardRec, after: CardRec, status: FieldRec | undefined): boolean {
    const asked = { ...after, values: { ...after.values, status: before.values.status ?? null } };
    const { auto } = settle(before, asked as CardRec, status);
    return auto != null && optionWithRole(status, auto)?.id === after.values.status;
  }

  /**
   * Background images no longer in use (replaced, taken away, or uploaded and never saved): their
   * file records go, and their bytes. `keep` is one just uploaded, waiting for Save. Call inside
   * a transaction.
   */
  private sweepBackgrounds(after: BoardRec | null, keep?: string): Rec[] {
    const now = after?.background && 'image' in after.background ? after.background.image : null;
    const board = this.boardId();
    const out: Rec[] = [];
    for (const f of this.all('file')) {
      if (f.cardId !== BOARD_FILE || f.id === now || f.id === keep) continue;
      this.ctx.waitUntil(this.env.FILES.delete([`${board}/${f.id}`, `${board}/${f.id}.thumb`]));
      out.push(this.write('file', f.id, null));
    }
    return out;
  }

  /**
   * A background image was uploaded (admins). It waits as a file of the board until an admin
   * saves the board with it; only then does it show behind the columns.
   */
  async addBackground(f: FileRec): Promise<{ file: FileRec | null }> {
    const out: Rec[] = [];
    const file = { ...f, cardId: BOARD_FILE };
    // Null: the board is full.
    if (!this.room(JSON.stringify(file).length, true)) return { file: null };
    this.tx(() => {
      out.push(this.write('file', f.id, file));
      out.push(...this.sweepBackgrounds(this.get('board', 'main'), f.id));
    });
    this.broadcast(out, null);
    return { file };
  }

  /** Keep the directory's copy of the board's name and colour (the board list reads it). */
  private mirrorBoard(b: BoardRec): void {
    const id = this.boardId();
    if (id)
      this.ctx.waitUntil(
        this.env.DB.prepare('UPDATE boards SET name = ?, hue = ? WHERE id = ?').bind(b.name, b.hue, id).run().then(() => {}),
      );
  }

  private boardId(): string | null {
    return this.sql.exec<{ v: string }>("SELECT v FROM kv WHERE k = 'id'").toArray()[0]?.v ?? null;
  }

  // ---------- called by the Worker ----------

  /** A new board: its settings, default fields, first admin and first log entry. */
  async init(id: string, board: BoardRec, creator: MemberRec): Promise<void> {
    const now = Date.now();
    this.tx(() => {
      if (this.boardId()) return;
      this.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('id', ?)", id);
      this.write('board', 'main', board);
      for (const f of DEFAULT_FIELDS) this.write('field', f.id, f);
      this.write('member', creator.userId, creator);
      this.log(null, creator.userId, { action: 'board_created', detail: { name: board.name } }, now);
    });
  }

  /**
   * Someone joined, or their name, colour or role changed. Their open connections take the
   * new role at once.
   */
  async setMember(m: MemberRec, by: string | null): Promise<void> {
    const now = Date.now();
    const out: Rec[] = [];
    this.tx(() => {
      const before = this.get('member', m.userId);
      if (before && JSON.stringify(before) === JSON.stringify(m)) return;
      out.push(this.write('member', m.userId, m));
      if (!before) {
        out.push(this.log(null, by, { action: 'member_added', detail: { user: m.userId, role: m.role } }, now));
        this.note(null, memberNote('added', m.userId, m.role, this.noteCtx(by, now)));
      } else if (before.role !== m.role) {
        out.push(this.log(null, by, { action: 'role_changed', detail: { user: m.userId, role: m.role } }, now));
        this.note(null, memberNote('role', m.userId, m.role, this.noteCtx(by, now)));
      }
    });
    for (const ws of this.ctx.getWebSockets(m.userId)) ws.serializeAttachment({ userId: m.userId, role: m.role } satisfies Attachment);
    this.broadcast(out, null);
    this.sendNotes();
  }

  /**
   * Someone left or was removed: they come off every card that isn't finished, and their open
   * connections close with 4003 so their devices delete the board.
   */
  async removeMember(userId: string, by: string | null): Promise<void> {
    const now = Date.now();
    const out: Rec[] = [];
    this.tx(() => {
      if (!this.get('member', userId)) return;
      this.note(null, memberNote('removed', userId, null, this.noteCtx(by, now)));
      out.push(this.write('member', userId, null));
      out.push(this.log(null, by, { action: 'member_removed', detail: { user: userId } }, now));
      const status = this.get('field', 'status') ?? undefined;
      for (const card of this.all('card')) {
        if (card.archived || !card.assignees.includes(userId) || card.done[userId] != null) continue;
        const next = settle(card, { ...card, assignees: card.assignees.filter((u) => u !== userId) }, status).card;
        out.push(this.write('card', card.id, next));
        out.push(this.log(card.id, by, { action: 'unassigned', detail: { user: userId } }, now));
      }
    });
    for (const ws of this.ctx.getWebSockets(userId)) ws.close(4003, 'Removed from board');
    this.broadcast(out, null);
    this.sendNotes();
  }

  /** The board was deleted: close every connection and drop everything. */
  async erase(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) ws.close(4003, 'Board deleted');
    await this.ctx.storage.deleteAll();
    this.usage = null;
  }

  /** The R2 keys of every file, so a deleted board's files can go too. */
  async fileKeys(): Promise<string[]> {
    return this.all('file').flatMap((f) => [`${this.boardId()}/${f.id}`, ...(f.thumb ? [`${this.boardId()}/${f.id}.thumb`] : [])]);
  }

  async info(): Promise<{ board: BoardRec | null; members: MemberRec[] }> {
    return { board: this.get('board', 'main'), members: this.all('member') };
  }

  // ---------- Elastic ----------

  /**
   * The cards Elastic may see for this person (R8.2, R8.3, R8.12, R8.13, R8.18): assigned to
   * them, not archived, with at least one date, and only the fields the contract names.
   */
  async myCards(userId: string, appUrl: string): Promise<ElasticCard[]> {
    const board = this.get('board', 'main');
    const id = this.boardId();
    if (!board || !id || !this.get('member', userId)) return [];
    const status = this.get('field', 'status') ?? undefined;
    const done = optionWithRole(status, 'completed');
    const cards = this.all('card').filter(
      (c) => !c.archived && c.assignees.includes(userId) && (typeof c.values.start === 'string' || typeof c.values.end === 'string'),
    );
    const doneAt = done ? this.completedAt(new Set(cards.filter((c) => c.values.status === done.id).map((c) => c.id)), done.label) : new Map();
    const out: ElasticCard[] = [];
    for (const c of cards) {
      const start = typeof c.values.start === 'string' ? c.values.start : null;
      const end = typeof c.values.end === 'string' ? c.values.end : null;
      const opt = status?.options?.find((o) => o.id === c.values.status);
      const completed = !!done && c.values.status === done.id;
      out.push({
        id: c.id,
        title: c.title,
        start,
        end,
        hasTime: [start, end].some((v) => !!v && v.includes('T')),
        board: { id, name: board.name, hue: board.hue },
        status: { label: opt?.label ?? null, role: opt?.role ?? null },
        myDone: c.done[userId] ?? null,
        completed,
        completedAt: completed ? (doneAt.get(c.id) ?? null) : null,
        url: `${appUrl.replace(/\/?$/, '/')}?card=${id}/${c.id}`,
      });
    }
    return out;
  }

  /** When each of these cards last became Completed, from the log, read once, newest first. */
  private completedAt(ids: Set<string>, label: string): Map<string, number> {
    const out = new Map<string, number>();
    if (!ids.size) return out;
    for (const r of this.sql.exec<{ data: string }>(
      "SELECT data FROM records WHERE kind = 'log' AND data IS NOT NULL ORDER BY rev DESC",
    )) {
      const l = JSON.parse(r.data) as LogRec;
      if (l.cardId && ids.has(l.cardId) && !out.has(l.cardId) && l.action === 'status' && l.detail.to === label) {
        out.set(l.cardId, l.at);
        if (out.size === ids.size) break;
      }
    }
    return out;
  }

  /**
   * Timers and done marks from Elastic (R5.6, R5.7, R8.22 to R8.27). Each op counts once, by
   * id, and is logged at the time it really happened (`at`), even when it arrives late.
   */
  async elasticOps(userId: string, ops: ElasticOp[]): Promise<{ id: string; ok: boolean; error?: string }[]> {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    const out: Rec[] = [];
    this.tx(() => {
      // Op ids past the age any op is taken at go: they can't come again.
      const old = this.sql.exec('DELETE FROM ops WHERE at < ? RETURNING id', Date.now() - OPS_KEEP_MS).toArray().length;
      if (old) this.used(-old, 0);
      for (const op of ops) {
        if (this.sql.exec('SELECT 1 FROM ops WHERE id = ?', op.id).toArray().length) {
          results.push({ id: op.id, ok: true });
          continue;
        }
        const card = this.get('card', op.cardId);
        if (!card || !card.assignees.includes(userId)) {
          results.push({ id: op.id, ok: false, error: 'not-assigned' });
          continue;
        }
        // A full board takes no more (Elastic drops an answered op, refused or not).
        if (!this.room(op.id.length + 1000, true)) {
          results.push({ id: op.id, ok: false, error: 'bad' });
          continue;
        }
        this.sql.exec('INSERT INTO ops (id, at) VALUES (?, ?)', op.id, Date.now());
        this.used(1, op.id.length);
        out.push(...this.applyOp(userId, card, op));
        results.push({ id: op.id, ok: true });
      }
    });
    this.broadcast(out, null);
    this.sendNotes(userId);
    return results;
  }

  private applyOp(userId: string, card: CardRec, op: ElasticOp): Rec[] {
    const out: Rec[] = [];
    const status = this.get('field', 'status') ?? undefined;
    const statusName = (id: unknown) => status?.options?.find((o) => o.id === id)?.label ?? null;
    const save = (next: CardRec, via: string) => {
      const { card: settled, auto } = settle(card, next, status);
      out.push(this.write('card', card.id, settled));
      this.note(userId, cardNotes(card, settled, this.noteCtx(userId, op.at)));
      for (const e of cardChanges(card, { ...settled, values: { ...settled.values, status: card.values.status ?? null } }, new Map(), new Map()))
        out.push(this.log(card.id, userId, { ...e, detail: { ...e.detail, via } }, op.at));
      if (auto)
        out.push(
          this.log(card.id, null, { action: 'status', detail: { field: 'status', name: status?.name ?? 'Status', from: statusName(card.values.status), to: statusName(settled.values.status), auto: true } }, op.at),
        );
    };
    if (op.type === 'start') {
      if (!this.get('session', op.sessionId)) {
        const s: SessionRec = { id: op.sessionId, cardId: card.id, userId, start: op.at, end: null };
        out.push(this.write('session', s.id, s));
      }
      // Starting sets the card to In progress, whatever it was (R5.6).
      const prog = optionWithRole(status, 'in_progress');
      if (prog && card.values.status !== prog.id) {
        const next = { ...card, values: { ...card.values, status: prog.id } };
        out.push(this.write('card', card.id, next));
        this.note(userId, cardNotes(card, next, this.noteCtx(userId, op.at)));
        out.push(
          this.log(card.id, userId, { action: 'status', detail: { field: 'status', name: status?.name ?? 'Status', from: statusName(card.values.status), to: prog.label, via: 'elastic' } }, op.at),
        );
      }
    } else if (op.type === 'stop') {
      const s = this.get('session', op.sessionId);
      // The session must be this person's and this card's: a stop names both.
      if (s && s.end == null && s.userId === userId && s.cardId === card.id) {
        const end = Math.max(s.start, op.at);
        out.push(this.write('session', s.id, { ...s, end }));
        out.push(this.log(card.id, userId, { action: 'worked', detail: { ms: end - s.start, from: 'elastic' } }, op.at));
      }
    } else if (op.type === 'done') {
      if (card.done[userId] == null) save({ ...card, done: { ...card.done, [userId]: op.at } }, 'elastic');
    } else if (op.type === 'undone') {
      if (card.done[userId] != null) {
        const done = { ...card.done };
        delete done[userId];
        save({ ...card, done }, 'elastic');
      }
    }
    return out;
  }

  // ---------- files ----------

  async maxUploadMB(): Promise<number> {
    return this.get('board', 'main')?.maxUploadMB ?? 30;
  }

  /** Whether a card is there and not archived (files are only added to those). */
  async cardOpen(cardId: string): Promise<boolean> {
    const c = this.get('card', cardId);
    return !!c && !c.archived;
  }

  async fileInfo(id: string): Promise<FileRec | null> {
    return this.get('file', id);
  }

  async filesById(ids: string[]): Promise<FileRec[]> {
    return ids.map((id) => this.get('file', id)).filter((f): f is FileRec => !!f);
  }

  /** A file was stored: its record and a log entry. Null if the card went meanwhile, `full` if the board is. */
  async addFile(userId: string, f: FileRec): Promise<{ file: FileRec | null; full?: boolean }> {
    const out: Rec[] = [];
    let ok = false;
    if (!this.room(JSON.stringify(f).length + 300, true)) return { file: null, full: true };
    this.tx(() => {
      const card = this.get('card', f.cardId);
      if (!card || card.archived) return;
      ok = true;
      out.push(this.write('file', f.id, f));
      out.push(this.log(f.cardId, userId, { action: 'file_added', detail: { name: f.name } }, Date.now()));
    });
    this.broadcast(out, null);
    return { file: ok ? f : null };
  }

  async markThumb(id: string): Promise<FileRec | null> {
    const f = this.get('file', id);
    if (!f) return null;
    const next = { ...f, thumb: true };
    let rec: Rec | null = null;
    this.tx(() => void (rec = this.write('file', id, next)));
    if (rec) this.broadcast([rec], null);
    return next;
  }

  /**
   * Delete an archived card for good (an admin, or whoever made it): the card, its comments,
   * files and time go; its log stays, with an entry saying it was deleted. Returns the R2 keys
   * of its files so their bytes can go too.
   */
  async deleteCard(userId: string, role: Role, cardId: string): Promise<{ keys: string[] } | 'gone' | 'denied' | 'live'> {
    const card = this.get('card', cardId);
    if (!card) return 'gone';
    if (role !== 'admin' && card.createdBy !== userId) return 'denied';
    if (!card.archived) return 'live';
    const board = this.boardId();
    const keys: string[] = [];
    const out: Rec[] = [];
    this.tx(() => {
      for (const c of this.all('comment')) if (c.cardId === cardId) out.push(this.write('comment', c.id, null));
      for (const s of this.all('session')) if (s.cardId === cardId) out.push(this.write('session', s.id, null));
      for (const f of this.all('file'))
        if (f.cardId === cardId) {
          keys.push(`${board}/${f.id}`, `${board}/${f.id}.thumb`);
          out.push(this.write('file', f.id, null));
        }
      out.push(this.write('card', cardId, null));
      out.push(this.log(cardId, userId, { action: 'deleted', detail: { title: card.title } }, Date.now()));
    });
    this.broadcast(out, null);
    return { keys };
  }

  /** Remove a file's record (whoever added it, or an admin). Returns it, so its bytes can go too. */
  async removeFile(userId: string, role: Role, id: string): Promise<FileRec | null | 'denied'> {
    const f = this.get('file', id);
    if (!f) return null;
    if (f.by !== userId && role !== 'admin') return 'denied';
    const out: Rec[] = [];
    this.tx(() => {
      out.push(this.write('file', id, null));
      out.push(this.log(f.cardId, userId, { action: 'file_removed', detail: { name: f.name } }, Date.now()));
    });
    this.broadcast(out, null);
    return f;
  }
}

/** The lower of two roles. */
const lesser = (a: Role, b: Role): Role => (a === 'admin' && b === 'admin' ? 'admin' : 'member');

const bgKind = (b: BoardRec) => (!b.background ? 'none' : 'image' in b.background ? 'image' : 'colour');

type KindOf<K extends Kind> = K extends keyof import('../../shared/model').KindData
  ? import('../../shared/model').KindData[K]
  : never;
