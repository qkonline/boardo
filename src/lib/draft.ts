// A card's unsaved changes (the card window's draft), and saving them on a card other people may
// have changed meanwhile. The draft remembers, for each thing it changes, what that was when the
// change began: lists then combine (who was added and who was taken off), and a text someone else
// changed too is a clash to settle before saving, never written over without a word (R9.5c).

import type { CardRec, FieldRec } from '../../shared/model';
import { sets } from './merge';

export type Value = string | number | boolean | null;
export type Changes = { title?: string; desc?: string; columnId?: string; assignees?: string[]; deps?: string[]; values?: Record<string, Value> };
/** What's being changed, and what each of those was when it started. */
export interface Draft {
  to: Changes;
  from: Changes;
}
/** A text changed here and, since, by someone else. `key` is 'title', 'desc' or a field's id. */
export interface Clash {
  key: string;
  mine: string;
  theirs: string;
}

export const emptyDraft = (): Draft => ({ to: {}, from: {} });
export const isEmpty = (d: Draft) => !Object.keys(d.to).length;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const tidy = (title: string) => title.replace(/\s+/g, ' ').trim();

/** The draft with one thing changed, on the card as it is now. */
export function change<K extends Exclude<keyof Changes, 'values'>>(d: Draft, card: CardRec, key: K, v: Changes[K]): Draft {
  // A text keeps what it was when the typing began. A choice starts from the card as it is now:
  // that's what was on screen when it was made.
  const typed = key === 'title' || key === 'desc';
  const from = typed && key in d.from ? d.from : { ...d.from, [key]: card[key] ?? (key === 'deps' ? [] : undefined) };
  return { to: { ...d.to, [key]: v }, from };
}

export function changeValue(d: Draft, card: CardRec, field: string, v: Value, typed = false): Draft {
  const had = typed && d.from.values && field in d.from.values;
  return {
    to: { ...d.to, values: { ...d.to.values, [field]: v } },
    from: had ? d.from : { ...d.from, values: { ...d.from.values, [field]: card.values[field] ?? null } },
  };
}

/** The card as it would be with the draft saved. */
export function withDraft(card: CardRec, d: Draft): CardRec {
  const { to, from } = d;
  const values = { ...card.values };
  for (const [k, v] of Object.entries(to.values ?? {})) {
    // Put back as it was: no change here, so anyone else's stands.
    if (same(v || null, from.values?.[k] || null)) continue;
    if (v == null || v === '') delete values[k];
    else values[k] = v;
  }
  const out: CardRec = { ...card, values };
  if (to.title != null && to.title !== from.title) out.title = to.title;
  if (to.desc != null && to.desc !== from.desc) out.desc = to.desc;
  if (to.columnId) out.columnId = to.columnId;
  if (to.assignees) out.assignees = sets(from.assignees ?? null, to.assignees, card.assignees);
  if (to.deps) out.deps = sets(from.deps ?? null, to.deps, card.deps ?? []);
  return out;
}

/** Only what saving the draft would change. */
export function draftPatch(card: CardRec, d: Draft): Partial<CardRec> {
  const next = withDraft(card, d);
  const p: Partial<CardRec> = {};
  const title = tidy(next.title);
  if (d.to.title != null && d.to.title !== d.from.title && title && title !== card.title) p.title = title;
  if (d.to.desc != null && next.desc !== card.desc) p.desc = next.desc;
  if (d.to.columnId && next.columnId !== card.columnId) p.columnId = next.columnId;
  if (d.to.assignees && !same([...next.assignees].sort(), [...card.assignees].sort())) p.assignees = next.assignees;
  if (d.to.deps && !same(next.deps, card.deps ?? [])) p.deps = next.deps;
  if (d.to.values && !same(next.values, card.values)) p.values = next.values;
  return p;
}

/** The texts someone else changed since they began to be changed here. */
export function clashes(card: CardRec, d: Draft, fields: ReadonlyMap<string, FieldRec>): Clash[] {
  const out: Clash[] = [];
  const check = (key: string, from: unknown, mine: unknown, theirs: unknown) => {
    if (!same(mine || null, from || null) && !same(from || null, theirs || null) && !same(mine || null, theirs || null))
      out.push({ key, mine: String(mine ?? ''), theirs: String(theirs ?? '') });
  };
  if (d.to.title != null && tidy(d.to.title)) check('title', d.from.title, tidy(d.to.title), card.title);
  if (d.to.desc != null) check('desc', d.from.desc, d.to.desc, card.desc);
  for (const [id, v] of Object.entries(d.to.values ?? {})) {
    const type = fields.get(id)?.type;
    if (type === 'text' || type === 'longtext') check(id, d.from.values?.[id], v, card.values[id]);
  }
  return out;
}

/** A clash settled: mine goes over theirs when saved, or mine is let go. */
export function settleClash(d: Draft, card: CardRec, key: string, keep: 'mine' | 'theirs'): Draft {
  if (key === 'title' || key === 'desc') {
    if (keep === 'mine') return { to: d.to, from: { ...d.from, [key]: card[key] } };
    const { [key]: _t, ...to } = d.to;
    const { [key]: _f, ...from } = d.from;
    return { to, from };
  }
  if (keep === 'mine') return { to: d.to, from: { ...d.from, values: { ...d.from.values, [key]: card.values[key] ?? null } } };
  const { [key]: _v, ...values } = d.to.values ?? {};
  const { [key]: _w, ...was } = d.from.values ?? {};
  const out: Draft = { to: { ...d.to, values }, from: { ...d.from, values: was } };
  if (!Object.keys(values).length) {
    delete out.to.values;
    delete out.from.values;
  }
  return out;
}

/** What's kept on the device for one card: its draft, and a comment being written or edited. */
export interface KeptDraft {
  title: string;
  draft: Draft;
  comment: string;
  edit: { id: string; text: string } | null;
  at: number;
}

/** Values that are somebody's writing, rather than a choice, a date or a short figure. */
export const writing = (v: unknown): v is string => typeof v === 'string' && v.length > 20 && !/^\d{4}-\d\d-\d\d/.test(v);

/** The words in an unsaved draft, as copies to keep when its card or board is gone (Account). */
export function draftWords(k: KeptDraft): { kind: 'card' | 'comment'; data: object }[] {
  const out: { kind: 'card' | 'comment'; data: object }[] = [];
  const { title, desc, values } = k.draft.to;
  const texts = Object.values(values ?? {}).filter(writing);
  const words = [desc, ...texts].filter(Boolean).join('\n\n');
  if (title != null || words) out.push({ kind: 'card', data: { title: title ?? k.title, desc: words } });
  if (k.comment.trim()) out.push({ kind: 'comment', data: { text: k.comment } });
  if (k.edit?.text.trim()) out.push({ kind: 'comment', data: { text: k.edit.text } });
  return out;
}
