// One board as this device holds it: every record, by kind, in maps that are replaced (not
// mutated) when something changes, so anything reading them updates.

import type {
  BoardRec,
  CardRec,
  ColumnRec,
  CommentRec,
  FieldRec,
  FileRec,
  Kind,
  KindData,
  LogRec,
  MemberRec,
  SessionRec,
} from '../../shared/model';
import type { SyncStatus } from './sync';

type Maps = { [K in Exclude<Kind, 'board'>]: Map<string, KindData[K]> };

export class BoardState {
  board = $state.raw<BoardRec | null>(null);
  member = $state.raw(new Map<string, MemberRec>());
  column = $state.raw(new Map<string, ColumnRec>());
  field = $state.raw(new Map<string, FieldRec>());
  card = $state.raw(new Map<string, CardRec>());
  comment = $state.raw(new Map<string, CommentRec>());
  file = $state.raw(new Map<string, FileRec>());
  session = $state.raw(new Map<string, SessionRec>());
  log = $state.raw(new Map<string, LogRec>());
  status = $state<SyncStatus>('connecting');
  /** Something has arrived from the board (or was stored here before): it can be shown. */
  loaded = $state(false);

  constructor(readonly id: string) {}

  /** Take in a batch of records (null data: deleted). */
  apply(recs: { kind: Kind; key: string; data: unknown }[]): void {
    const next: Partial<Record<Kind, Map<string, unknown>>> = {};
    for (const r of recs) {
      if (r.kind === 'board') {
        if (r.data) this.board = r.data as BoardRec;
        continue;
      }
      const map = (next[r.kind] ??= new Map(this[r.kind] as Map<string, unknown>));
      if (r.data == null) map.delete(r.key);
      else map.set(r.key, r.data);
    }
    for (const [k, m] of Object.entries(next)) (this as unknown as Maps)[k as keyof Maps] = m as never;
    if (recs.length) this.loaded = true;
  }

  columns = $derived([...this.column.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)));
  fields = $derived([...this.field.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)));
  members = $derived([...this.member.values()].sort((a, b) => a.name.localeCompare(b.name)));
  statusField = $derived(this.field.get('status'));
  logs = $derived([...this.log.values()].sort((a, b) => b.at - a.at));

  /** Cards in a column, in order, archived ones left out. */
  cardsIn(columnId: string): CardRec[] {
    return [...this.card.values()]
      .filter((c) => c.columnId === columnId && !c.archived)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  /** Cards whose column has gone (removed on another device while this one moved them). */
  orphans = $derived([...this.card.values()].filter((c) => !c.archived && !this.column.has(c.columnId)));

  archived = $derived([...this.card.values()].filter((c) => c.archived).sort((a, b) => b.created - a.created));

  role(userId: string | undefined) {
    return userId ? this.member.get(userId)?.role : undefined;
  }

  commentsOn(cardId: string): CommentRec[] {
    return [...this.comment.values()].filter((c) => c.cardId === cardId && !c.deleted).sort((a, b) => a.at - b.at);
  }

  filesOn(cardId: string): FileRec[] {
    return [...this.file.values()].filter((f) => f.cardId === cardId).sort((a, b) => a.at - b.at);
  }

  sessionsOn(cardId: string): SessionRec[] {
    return [...this.session.values()].filter((s) => s.cardId === cardId);
  }

  logsOn(cardId: string): LogRec[] {
    return this.logs.filter((l) => l.cardId === cardId);
  }

  /** Time spent on a card: in total and per person, counting a running session up to now. */
  timeOn(cardId: string, now = Date.now()): { total: number; by: Map<string, number>; running: boolean } {
    const by = new Map<string, number>();
    let total = 0;
    let running = false;
    for (const s of this.sessionsOn(cardId)) {
      const ms = Math.max(0, (s.end ?? now) - s.start);
      if (s.end == null) running = true;
      total += ms;
      by.set(s.userId, (by.get(s.userId) ?? 0) + ms);
    }
    return { total, by, running };
  }
}
