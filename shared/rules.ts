// Rules that both sides need to agree on: when a card completes, what each change to a card
// logs, and what its status is. The board's Durable Object applies them to every change it
// accepts; the app uses the same functions to show things the way the server will.

import type { BoardRec, CardRec, FieldOption, FieldRec, LogAction, StatusRole } from './model';

type Detail = Record<string, string | number | boolean | null>;
export interface LogEntry {
  action: LogAction;
  detail: Detail;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The status option a card is on, if any. */
export function statusOption(card: Pick<CardRec, 'values'>, status: FieldRec | undefined): FieldOption | undefined {
  const v = card.values.status;
  return status?.options?.find((o) => o.id === v);
}

export function optionWithRole(status: FieldRec | undefined, role: StatusRole): FieldOption | undefined {
  return status?.options?.find((o) => o.role === role);
}

/**
 * A new card starts with the board's defaults (R3.7): its person, while still in the board, and
 * its status, while still one of the options; each only where the card has none of its own.
 */
export function withNewCardDefaults(card: CardRec, board: BoardRec | null | undefined, members: Iterable<string>, status: FieldRec | undefined): CardRec {
  const d = board?.newCards;
  if (!d) return card;
  let out = card;
  if (d.assignee && !out.assignees.length && [...members].includes(d.assignee)) out = { ...out, assignees: [d.assignee] };
  if (d.status && out.values.status == null && status?.options?.some((o) => o.id === d.status))
    out = { ...out, values: { ...out.values, status: d.status } };
  return out;
}

/** A name as two columns are compared (R3.4a): letter case and extra spaces aside. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** The column already called `name`, other than `except`, if any (an unnamed one never clashes). */
export function sameNamed<T extends { id: string; name: string }>(columns: T[], name: string, except?: string): T | undefined {
  const key = nameKey(name);
  return key ? columns.find((c) => c.id !== except && nameKey(c.name) === key) : undefined;
}

/** Whether every assignee has finished their part (a card with nobody on it never is). */
export function allPartsDone(card: Pick<CardRec, 'assignees' | 'done'>): boolean {
  return card.assignees.length > 0 && card.assignees.every((u) => card.done[u] != null);
}

/**
 * Picking Completed by hand is the person's own Mark done, and moving a card off Completed their
 * own Mark not done (R5.5d): for someone on the card, the status and their part are one thing.
 * With others on the card it's just their part, as with Mark done: the card keeps its status
 * until everyone's done, then settle() completes it. Someone not on the card sets the status as
 * it is. Call before settle().
 */
export function statusAsPart(prev: CardRec | null, next: CardRec, actor: string, status: FieldRec | undefined, now: number): CardRec {
  const completed = optionWithRole(status, 'completed');
  if (!completed || !prev || !next.assignees.includes(actor)) return next;
  const was = prev.values.status ?? null;
  const is = next.values.status ?? null;
  if (was === is) return next;
  if (is === completed.id && next.done[actor] == null) {
    const card = { ...next, done: { ...next.done, [actor]: now } };
    return allPartsDone(card) ? card : { ...card, values: { ...card.values, status: was } };
  }
  if (was === completed.id && is !== completed.id && next.done[actor] != null) {
    const done = { ...next.done };
    delete done[actor];
    return { ...next, done };
  }
  return next;
}

/**
 * Apply the completion rules to a card that's about to be saved (R5.1 to R5.5):
 * - parts belong to assignees only, so a part of someone no longer assigned goes;
 * - when the last part is done, the card becomes Completed;
 * - when a part is undone, or someone is added, a Completed card goes back to In progress;
 * - a status picked by hand is left alone otherwise (statusAsPart() turns it into the picker's own part first).
 * Returns the card to save and, when the status was changed here, the role it moved to.
 */
export function settle(
  prev: CardRec | null,
  next: CardRec,
  status: FieldRec | undefined,
): { card: CardRec; auto: StatusRole | null } {
  const done: Record<string, number> = {};
  for (const u of next.assignees) if (next.done[u] != null) done[u] = next.done[u];
  let card: CardRec = same(done, next.done) ? next : { ...next, done };
  const role = statusOption(card, status)?.role;
  const nowAll = allPartsDone(card);
  const wasAll = prev ? allPartsDone(prev) : false;
  if (nowAll && !wasAll && role !== 'completed') {
    const o = optionWithRole(status, 'completed');
    if (o) return { card: { ...card, values: { ...card.values, status: o.id } }, auto: 'completed' };
  }
  if (!nowAll && role === 'completed' && prev) {
    const undone = prev.assignees.some((u) => prev.done[u] != null && card.assignees.includes(u) && card.done[u] == null);
    const added = card.assignees.some((u) => !prev.assignees.includes(u));
    if (undone || added) {
      const o = optionWithRole(status, 'in_progress');
      if (o) return { card: { ...card, values: { ...card.values, status: o.id } }, auto: 'in_progress' };
    }
  }
  return { card, auto: null };
}

/** Short text for a value in the log: dropdown labels rather than ids, long text cut down. */
function shown(v: unknown, field: FieldRec | undefined): string | number | boolean | null {
  if (v == null || v === '') return null;
  if (field?.type === 'dropdown') return field.options?.find((o) => o.id === v)?.label ?? String(v);
  if (typeof v === 'string' && v.length > 120) return v.slice(0, 117) + '...';
  return v as string | number | boolean;
}

/**
 * What a change to a card logs. `fields` are the board's fields by id; `columns` the column
 * names by id. The status change made by `settle()` is logged separately, as automatic.
 */
export function cardChanges(
  prev: CardRec | null,
  next: CardRec | null,
  fields: Map<string, FieldRec>,
  columns: Map<string, string>,
): LogEntry[] {
  if (!next) return prev ? [{ action: 'deleted', detail: { title: prev.title } }] : [];
  if (!prev) return [{ action: 'created', detail: { title: next.title, column: columns.get(next.columnId) ?? null } }];
  const out: LogEntry[] = [];
  if (prev.archived !== next.archived) out.push({ action: next.archived ? 'archived' : 'restored', detail: {} });
  if (prev.columnId !== next.columnId)
    out.push({
      action: 'moved',
      detail: { from: columns.get(prev.columnId) ?? null, to: columns.get(next.columnId) ?? null },
    });
  if (prev.title !== next.title) out.push({ action: 'renamed', detail: { from: prev.title, to: next.title } });
  if (prev.desc !== next.desc) out.push({ action: 'described', detail: { to: shown(next.desc, undefined) } });
  for (const id of new Set([...Object.keys(prev.values), ...Object.keys(next.values)])) {
    const a = prev.values[id] ?? null;
    const b = next.values[id] ?? null;
    if (same(a, b)) continue;
    const f = fields.get(id);
    out.push({
      action: id === 'status' ? 'status' : 'changed',
      detail: { field: id, name: f?.name ?? null, from: shown(a, f), to: shown(b, f) },
    });
  }
  for (const u of next.assignees) if (!prev.assignees.includes(u)) out.push({ action: 'assigned', detail: { user: u } });
  for (const u of prev.assignees) if (!next.assignees.includes(u)) out.push({ action: 'unassigned', detail: { user: u } });
  const before = prev.deps ?? [];
  const after = next.deps ?? [];
  for (const c of after) if (!before.includes(c)) out.push({ action: 'linked', detail: { card: c } });
  for (const c of before) if (!after.includes(c)) out.push({ action: 'unlinked', detail: { card: c } });
  for (const u of next.assignees) {
    const was = prev.done[u] != null;
    const now = next.done[u] != null;
    if (was !== now) out.push({ action: now ? 'part_done' : 'part_undone', detail: { user: u } });
  }
  return out;
}
