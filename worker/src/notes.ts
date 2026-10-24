// Who hears about a change, in the bell (and on their phone, if they turned alerts on). The board
// calls these with each change it accepts; they only decide, and inbox.ts stores and sends.
//
// - Anyone newly @mentioned in a description or comment.
// - Anyone put on a card, or taken off it.
// - The people a card is for (its assignees and whoever made it): new comments, a new status
//   (or Completed), a new due date.
// - The people on a card waiting on one that's now done, once everything it waits on is.
// - Someone added to the board, given a new role, or taken out.
//
// Never the person who made the change, and never someone no longer in the board.

import { clip, mentioned, mentionLine } from '../../shared/mentions';
import type { CardRec, CommentRec, FieldRec, MemberRec, Note, NoteKind, Role } from '../../shared/model';
import { optionWithRole } from '../../shared/rules';

/** An update on its way to one person: all of it but its id and read mark. */
export interface Outgoing {
  userId: string;
  note: Omit<Note, 'id' | 'read'>;
}

export interface NoteCtx {
  board: { id: string; name: string; hue: string };
  members: Map<string, MemberRec>;
  status?: FieldRec;
  /** Every card on the board (asked for only when a card is completed). */
  cards: () => CardRec[];
  /** Who made the change; null when nobody did (it happened by itself). */
  actor: string | null;
  now: number;
}

const QUOTE = 140;

function base(ctx: NoteCtx, kind: NoteKind, card: CardRec | null): Omit<Note, 'id' | 'read'> {
  const by = ctx.actor ? ctx.members.get(ctx.actor) : undefined;
  return {
    board: ctx.board.id,
    card: card?.id ?? null,
    kind,
    at: ctx.now,
    by: by ? { userId: by.userId, name: by.name, hue: by.hue, photo: by.photo ?? null } : null,
    boardName: ctx.board.name,
    boardHue: ctx.board.hue,
    ...(card ? { title: card.title } : {}),
  };
}

/** A card's news goes to its assignees and whoever made it. */
const audience = (card: CardRec) => new Set([...card.assignees, card.createdBy]);

/** Collects updates, leaving out the person who made the change and anyone not in the board. */
function collector(ctx: NoteCtx) {
  const out: Outgoing[] = [];
  const add = (userId: string, card: CardRec | null, kind: NoteKind, extra: Partial<Note> = {}) => {
    if (userId === ctx.actor || !ctx.members.has(userId)) return;
    out.push({ userId, note: { ...base(ctx, kind, card), ...extra } });
  };
  return { out, add };
}

export function cardNotes(before: CardRec | null, after: CardRec, ctx: NoteCtx): Outgoing[] {
  const { out, add } = collector(ctx);
  const people = [...ctx.members.values()];
  const had = before ? mentioned(before.desc, people) : new Set<string>();
  for (const u of mentioned(after.desc, people)) if (!had.has(u)) add(u, after, 'mention', { quote: mentionLine(after.desc, u, people, QUOTE) });

  const was = new Set(before?.assignees ?? []);
  const now = new Set(after.assignees);
  for (const u of now) if (!was.has(u)) add(u, after, 'assigned');
  for (const u of was) if (!now.has(u)) add(u, after, 'unassigned');
  if (!before) return out;

  // Someone just put on the card has heard about it already.
  const told = [...audience(after)].filter((u) => !(now.has(u) && !was.has(u)));
  const done = optionWithRole(ctx.status, 'completed');
  const status = (after.values.status ?? null) as string | null;
  if (status !== (before.values.status ?? null)) {
    if (done && status === done.id) {
      for (const u of told) add(u, after, 'completed', { by: null });
      const all = ctx.cards();
      const byId = new Map(all.map((c) => [c.id, c]));
      for (const w of all) {
        if (w.archived || w.id === after.id || !w.deps?.includes(after.id)) continue;
        if (!w.deps.every((d) => d === after.id || byId.get(d)?.values.status === done.id)) continue;
        for (const u of audience(w)) add(u, w, 'unblocked', { dep: after.title, by: null });
      }
    } else {
      const label = ctx.status?.options?.find((o) => o.id === status)?.label ?? null;
      for (const u of told) add(u, after, 'status', { to: label });
    }
  }
  const end = typeof after.values.end === 'string' ? after.values.end : null;
  if (end !== (typeof before.values.end === 'string' ? before.values.end : null)) for (const u of told) add(u, after, 'due', { to: end });
  return out;
}

export function commentNotes(before: CommentRec | null, after: CommentRec | null, card: CardRec | null, ctx: NoteCtx): Outgoing[] {
  if (!after || after.deleted || !card) return [];
  const { out, add } = collector(ctx);
  const people = [...ctx.members.values()];
  const had = before ? mentioned(before.text, people) : new Set<string>();
  const now = mentioned(after.text, people);
  for (const u of now) if (!had.has(u)) add(u, card, 'mention', { quote: mentionLine(after.text, u, people, QUOTE) });
  if (!before) for (const u of audience(card)) if (!now.has(u)) add(u, card, 'comment', { quote: clip(after.text.replace(/\s+/g, ' ').trim(), QUOTE) });
  return out;
}

/** Someone added to the board, given another role, or taken out (not by themselves). */
export function memberNote(kind: 'added' | 'role' | 'removed', userId: string, role: Role | null, ctx: NoteCtx): Outgoing[] {
  if (userId === ctx.actor) return [];
  return [{ userId, note: { ...base(ctx, kind, null), ...(role ? { to: role } : {}) } }];
}
