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
// change role, so the `member` records and open connections follow.

import { DurableObject } from 'cloudflare:workers';
import {
  ADMIN_KINDS,
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
} from '../../shared/model';
import { cardChanges, type LogEntry, optionWithRole, settle } from '../../shared/rules';
import { type Change, changes } from './checks';
import type { Env } from './env';

/** A record as it goes out to devices. `data` null: deleted. */
export interface Rec {
  kind: Kind;
  key: string;
  rev: number;
  data: unknown;
}

/** What each WebSocket remembers across the object sleeping. */
interface Attachment {
  userId: string;
  role: Role;
}

/** Big first syncs go out in pieces of about this size. */
const CHUNK = 400_000;
const MAX_RECORDS = 100_000;
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
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, role } satisfies Attachment);
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
    const att = ws.deserializeAttachment() as Attachment;
    if (m.t === 'hello') return this.sendSince(ws, Number.isInteger(m.since) ? (m.since as number) : 0);
    if (m.t === 'put') {
      const res = this.put(m.recs, att);
      if (!res) {
        ws.send(JSON.stringify({ t: 'ack', id: m.id, ok: [], conflicts: [], rejected: [], error: 'bad' }));
        return;
      }
      ws.send(
        JSON.stringify({ t: 'ack', id: m.id, ok: res.ok, conflicts: res.conflicts, rejected: res.rejected, rev: this.rev() }),
      );
      if (res.extra.length) ws.send(JSON.stringify({ t: 'changes', recs: res.extra, rev: this.rev() }));
      if (res.changed.length) this.broadcast(res.changed, ws);
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'Closed');
    } catch {
      /* already closed */
    }
  }

  /** Everything after `since`, oldest first, in pieces; the last piece says how far that got. */
  private sendSince(ws: WebSocket, since: number): void {
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
        ws.send(JSON.stringify({ t: 'changes', recs, more: true }));
        recs = [];
        size = 0;
      }
    }
    ws.send(JSON.stringify({ t: 'changes', recs, rev, done: true, reset: from === 0 && since > 0 }));
  }

  private broadcast(recs: Rec[], except: WebSocket | null): void {
    if (!recs.length) return;
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

  // ---------- records ----------

  private rev(): number {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM kv WHERE k = 'rev'").toArray()[0];
    return row ? Number(row.v) : 0;
  }

  private current(kind: Kind, key: string): { rev: number; data: unknown } | null {
    const row = this.sql
      .exec<{ rev: number; data: string | null }>('SELECT rev, data FROM records WHERE kind = ? AND key = ?', kind, key)
      .toArray()[0];
    return row ? { rev: row.rev, data: row.data == null ? null : JSON.parse(row.data) } : null;
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

  /** Store a record under the next rev. Call inside a transaction; returns it as sent out. */
  private write(kind: Kind, key: string, data: unknown): Rec {
    const rev = this.rev() + 1;
    this.sql.exec(
      'INSERT INTO records (kind, key, rev, data) VALUES (?, ?, ?, ?) ON CONFLICT (kind, key) DO UPDATE SET rev = excluded.rev, data = excluded.data',
      kind,
      key,
      rev,
      data == null ? null : JSON.stringify(data),
    );
    this.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('rev', ?)", String(rev));
    return { kind, key, rev, data: data ?? null };
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

  private count(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM records').one().n;
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

    this.ctx.storage.transactionSync(() => {
      let count: number | null = null;
      for (const c of parsed.list) {
        const cur = this.current(c.kind, c.key);
        if ((cur?.rev ?? 0) !== c.base) {
          res.conflicts.push({ kind: c.kind, key: c.key, rev: cur?.rev ?? 0, data: cur?.data ?? null });
          continue;
        }
        const prev = cur?.data ?? null;
        const data = this.allowed(c, prev, who, now);
        if (data === undefined) {
          res.rejected.push(asNow(c.kind, c.key));
          continue;
        }
        if (!cur) {
          count ??= this.count();
          if (count++ >= MAX_RECORDS) {
            res.rejected.push(asNow(c.kind, c.key));
            continue;
          }
        }
        const logs = this.logsFor(c.kind, prev, data, who.userId, now);
        const rec = this.write(c.kind, c.key, data);
        const adjusted = JSON.stringify(data) !== JSON.stringify(c.data);
        res.ok.push(adjusted ? { kind: c.kind, key: c.key, rev: rec.rev, data } : { kind: c.kind, key: c.key, rev: rec.rev });
        res.changed.push(rec);
        for (const l of logs) {
          const r = this.log(l.cardId, l.userId, l.entry, now);
          res.changed.push(r);
          res.extra.push(r);
        }
        if (c.kind === 'board' && data) this.mirrorBoard(data as BoardRec);
      }
    });
    return res;
  }

  /**
   * The record to store for a change, or undefined if this person may not make it. Cards get
   * the completion rule and keep everyone else's parts as they were.
   */
  private allowed(c: Change, prev: unknown, who: Attachment, now: number): unknown {
    const admin = who.role === 'admin';
    if (ADMIN_KINDS.includes(c.kind) && !admin) return undefined;
    switch (c.kind) {
      case 'board':
        return c.data ?? undefined; // a board is deleted through the Worker, never as a record
      case 'column':
        return c.data;
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
        if (!next) return undefined; // cards are archived, not deleted
        if (!before && next.createdBy !== who.userId) next = { ...next, createdBy: who.userId };
        if (!before && Math.abs(next.created - now) > 7 * 24 * 3600_000) next = { ...next, created: now };
        if (before) next = { ...next, createdBy: before.createdBy, created: before.created };
        // Only members can be assigned.
        const members = new Set(this.all('member').map((m) => m.userId));
        const assignees = next.assignees.filter((u) => members.has(u) || before?.assignees.includes(u));
        // Each person marks their own part; everyone else's stays as it was.
        const done: Record<string, number> = {};
        for (const [u, at] of Object.entries(before?.done ?? {})) if (u !== who.userId) done[u] = at;
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
      if (before && before.name !== after.name)
        return [{ cardId: null, userId, entry: { action: 'board_renamed', detail: { from: before.name, to: after.name } } }];
      return [];
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
    this.ctx.storage.transactionSync(() => {
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
    this.ctx.storage.transactionSync(() => {
      const before = this.get('member', m.userId);
      if (before && JSON.stringify(before) === JSON.stringify(m)) return;
      out.push(this.write('member', m.userId, m));
      if (!before) out.push(this.log(null, by, { action: 'member_added', detail: { user: m.userId, role: m.role } }, now));
      else if (before.role !== m.role)
        out.push(this.log(null, by, { action: 'role_changed', detail: { user: m.userId, role: m.role } }, now));
    });
    for (const ws of this.ctx.getWebSockets(m.userId)) ws.serializeAttachment({ userId: m.userId, role: m.role } satisfies Attachment);
    this.broadcast(out, null);
  }

  /**
   * Someone left or was removed: they come off every card that isn't finished, and their open
   * connections close with 4003 so their devices delete the board.
   */
  async removeMember(userId: string, by: string | null): Promise<void> {
    const now = Date.now();
    const out: Rec[] = [];
    this.ctx.storage.transactionSync(() => {
      if (!this.get('member', userId)) return;
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
  }

  /** The board was deleted: close every connection and drop everything. */
  async erase(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) ws.close(4003, 'Board deleted');
    await this.ctx.storage.deleteAll();
  }

  /** The R2 keys of every file, so a deleted board's files can go too. */
  async fileKeys(): Promise<string[]> {
    return this.all('file').flatMap((f) => [`${this.boardId()}/${f.id}`, ...(f.thumb ? [`${this.boardId()}/${f.id}.thumb`] : [])]);
  }

  async info(): Promise<{ board: BoardRec | null; members: MemberRec[] }> {
    return { board: this.get('board', 'main'), members: this.all('member') };
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

  /** A file was stored: its record and a log entry. Null if the card went meanwhile. */
  async addFile(userId: string, f: FileRec): Promise<FileRec | null> {
    const out: Rec[] = [];
    let ok = false;
    this.ctx.storage.transactionSync(() => {
      const card = this.get('card', f.cardId);
      if (!card || card.archived) return;
      ok = true;
      out.push(this.write('file', f.id, f));
      out.push(this.log(f.cardId, userId, { action: 'file_added', detail: { name: f.name } }, Date.now()));
    });
    this.broadcast(out, null);
    return ok ? f : null;
  }

  async markThumb(id: string): Promise<FileRec | null> {
    const f = this.get('file', id);
    if (!f) return null;
    const next = { ...f, thumb: true };
    let rec: Rec | null = null;
    this.ctx.storage.transactionSync(() => (rec = this.write('file', id, next)));
    if (rec) this.broadcast([rec], null);
    return next;
  }

  /** Remove a file's record (whoever added it, or an admin). Returns it, so its bytes can go too. */
  async removeFile(userId: string, role: Role, id: string): Promise<FileRec | null | 'denied'> {
    const f = this.get('file', id);
    if (!f) return null;
    if (f.by !== userId && role !== 'admin') return 'denied';
    const out: Rec[] = [];
    this.ctx.storage.transactionSync(() => {
      out.push(this.write('file', id, null));
      out.push(this.log(f.cardId, userId, { action: 'file_removed', detail: { name: f.name } }, Date.now()));
    });
    this.broadcast(out, null);
    return f;
  }
}

type KindOf<K extends Kind> = K extends keyof import('../../shared/model').KindData
  ? import('../../shared/model').KindData[K]
  : never;
