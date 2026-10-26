// Search (R3.6a, R9.16 to R9.20): on one board, and across every board on this device. It all
// happens here, on the device: every board a person is in is already held in memory, so search
// works offline and nothing typed leaves the device.
//
// The rules, the same everywhere (the Archived panel too):
// - capitals and accents don't count: "cafe" finds "Café";
// - every word typed must be found on the card;
// - a word is found at the start of a word on the card: "plan" finds "planning", "cat" doesn't
//   find "education" (scripts written without spaces, like Chinese, are found anywhere);
// - formatting marks in descriptions and comments don't count, nor does punctuation;
//   "e-mail" and "brief.pdf" are also found as "email" and "briefpdf".
// What's searched on a card: its title, description, comments, custom field values (as they read:
// a dropdown's words, a person's name, a ticked box's field name) and its files' names. Not its
// status, people, column or dates: the filters cover those, and each would match whole groups.

import type { BoardRec, CardRec, ColumnRec, CommentRec, FieldRec, FileRec, LogRec, MemberRec } from '../../shared/model';
import { BOARD_FILE } from '../../shared/model';
import { plain } from './format';

/** A board as search reads it (a `BoardState` is one). */
export interface Source {
  id: string;
  board: BoardRec | null;
  card: Map<string, CardRec>;
  comment: Map<string, CommentRec>;
  file: Map<string, FileRec>;
  field: Map<string, FieldRec>;
  member: Map<string, MemberRec>;
  column: Map<string, ColumnRec>;
  log: Map<string, LogRec>;
}

export type Where = 'title' | 'desc' | 'comment' | 'field' | 'file';

/** One searchable piece of a card: where it is, a short name for that, and its words. */
interface Part {
  where: Where;
  label: string;
  text: string;
  words: string;
}

export interface Hit {
  board: string;
  card: CardRec;
  score: number;
  /** When the card last saw anything happen: made, commented on, changed. */
  at: number;
  /** The best match outside the title, for the line under it (null: only the title matched). */
  part: { where: Where; label: string; text: string } | null;
}

/** A piece of text, marked where it matches what was typed. */
export interface Piece {
  text: string;
  hit?: boolean;
}

// ---------- words ----------

const EXTRA: Record<string, string> = { ß: 'ss', æ: 'ae', ø: 'o', ł: 'l', đ: 'd', œ: 'oe', ı: 'i', þ: 'th' };

/** Lower case, without accents. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[ßæøłđœıþ]/g, (c) => EXTRA[c]);
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const JOINED = /[\p{L}\p{N}]+(?:[-./][\p{L}\p{N}]+)+/gu;
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}]/u;

/** A text's words, folded, as one string with a space before and after each: " plan the q4 review ". */
function index(text: string): string {
  const out: string[] = [];
  for (const m of text.matchAll(WORD)) out.push(fold(m[0].replace(/['’]/g, '')));
  for (const m of text.matchAll(JOINED)) out.push(fold(m[0].replace(/[-./]/g, '')));
  return out.length ? ` ${out.join(' ')} ` : '';
}

/** What was typed, as the words to find (folded, each once). */
export function queryWords(q: string): string[] {
  const out: string[] = [];
  for (const m of q.matchAll(WORD)) {
    const w = fold(m[0].replace(/['’]/g, ''));
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

/** Whether `words` (from `index()`) has `q`: at the start of a word, or anywhere for unspaced scripts. */
function has(words: string, q: string): 0 | 1 | 2 {
  if (!words) return 0;
  if (words.includes(` ${q} `)) return 2;
  if (words.includes(` ${q}`)) return 1;
  return UNSPACED.test(q) && words.includes(q) ? 1 : 0;
}

// ---------- each board's cards, ready to search ----------

const WEIGHT: Record<Where, number> = { title: 8, file: 4, field: 4, desc: 3, comment: 2 };

interface Entry {
  card: CardRec;
  comments: CommentRec[];
  files: FileRec[];
  parts: Part[];
}

interface Cache {
  maps: unknown[];
  byCard: Map<string, CommentRec[]>;
  filesBy: Map<string, FileRec[]>;
  last: Map<string, number>;
  entries: Map<string, Entry>;
}

const caches = new WeakMap<object, Cache>();

function group<T extends { cardId: string | null }>(items: Iterable<T>, keep: (x: T) => boolean): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of items) if (x.cardId && keep(x)) (out.get(x.cardId) ?? out.set(x.cardId, []).get(x.cardId)!).push(x);
  return out;
}

const same = <T>(a: T[] | undefined, b: T[] | undefined) => (a ?? []).length === (b ?? []).length && (a ?? []).every((x, i) => x === b![i]);

/** A board's cards as search reads them. Only what changed since last time is read again. */
function entries(src: Source): Map<string, Entry> {
  let c = caches.get(src);
  const maps = [src.card, src.comment, src.file, src.field, src.member, src.log];
  if (c && c.maps.every((m, i) => m === maps[i])) return c.entries;
  const fieldsOrMembers = !c || c.maps[3] !== src.field || c.maps[4] !== src.member;
  const byCard = !c || c.maps[1] !== src.comment ? group(src.comment.values(), (x) => !x.deleted) : c.byCard;
  for (const list of byCard.values()) list.sort((a, b) => a.at - b.at);
  const filesBy = !c || c.maps[2] !== src.file ? group(src.file.values(), (f) => f.cardId !== BOARD_FILE) : c.filesBy;
  let last = c?.last ?? new Map<string, number>();
  if (!c || c.maps[5] !== src.log || c.maps[1] !== src.comment) {
    last = new Map();
    const note = (id: string | null, at: number) => id && last.set(id, Math.max(last.get(id) ?? 0, at));
    for (const l of src.log.values()) note(l.cardId, l.at);
    for (const x of src.comment.values()) note(x.cardId, x.editedAt ?? x.at);
  }
  const fields = [...src.field.values()].filter((f) => !f.builtin).sort((a, b) => a.order - b.order);
  const out = new Map<string, Entry>();
  for (const card of src.card.values()) {
    const prev = c?.entries.get(card.id);
    const comments = byCard.get(card.id) ?? [];
    const files = filesBy.get(card.id) ?? [];
    if (prev && !fieldsOrMembers && prev.card === card && same(prev.comments, comments) && same(prev.files, files)) {
      out.set(card.id, prev);
      continue;
    }
    out.set(card.id, { card, comments, files, parts: partsOf(card, comments, files, fields, src.member) });
  }
  caches.set(src, { maps, byCard, filesBy, last, entries: out });
  return out;
}

/** A field's value as words, or null for one that can't be searched (dates) or isn't set. */
function fieldWords(f: FieldRec, v: CardRec['values'][string], members: Map<string, MemberRec>): string | null {
  if (v == null || v === '' || v === false) return null;
  switch (f.type) {
    case 'text':
      return String(v);
    case 'longtext':
      return plain(String(v));
    case 'number':
      return String(v);
    case 'dropdown':
      return f.options?.find((o) => o.id === v)?.label ?? null;
    case 'person':
      return members.get(String(v))?.name ?? null;
    case 'checkbox':
      return f.name;
    default:
      return null;
  }
}

function partsOf(card: CardRec, comments: CommentRec[], files: FileRec[], fields: FieldRec[], members: Map<string, MemberRec>): Part[] {
  const parts: Part[] = [];
  const add = (where: Where, label: string, text: string) => {
    const words = index(text);
    if (words) parts.push({ where, label, text, words });
  };
  add('title', 'Title', card.title);
  if (card.desc) add('desc', 'Description', plain(card.desc));
  for (const f of fields) {
    const t = fieldWords(f, card.values[f.id], members);
    if (t) add('field', f.name, t);
  }
  for (const file of files) add('file', 'File', file.name);
  for (const x of comments) add('comment', `Comment by ${members.get(x.userId)?.name ?? 'someone'}`, plain(x.text));
  return parts;
}

// ---------- finding ----------

/** Every card on a board with all the words, best first (cards on the board before archived ones). */
export function matchBoard(src: Source, words: string[]): Hit[] {
  if (!words.length) return [];
  const all = entries(src);
  const last = caches.get(src)!.last;
  const out: Hit[] = [];
  for (const e of all.values()) {
    let score = 0;
    let best: { part: Part; s: number } | null = null;
    let ok = true;
    for (const q of words) {
      let top = 0;
      for (const p of e.parts) {
        const h = has(p.words, q);
        if (!h) continue;
        const s = WEIGHT[p.where] + (h === 2 ? 2 : 0);
        if (s > top) top = s;
        if (p.where !== 'title' && (!best || s > best.s)) best = { part: p, s };
      }
      if (!top) {
        ok = false;
        break;
      }
      score += top;
    }
    if (!ok) continue;
    if (e.parts[0]?.where === 'title' && words.every((q) => has(e.parts[0].words, q))) score += 6;
    const p = best?.part;
    out.push({
      board: src.id,
      card: e.card,
      score,
      at: Math.max(e.card.created, last.get(e.card.id) ?? 0),
      part: p ? { where: p.where, label: p.label, text: p.text } : null,
    });
  }
  return out.sort(
    (a, b) =>
      Number(a.card.archived) - Number(b.card.archived) ||
      b.score - a.score ||
      b.at - a.at ||
      a.card.title.localeCompare(b.card.title),
  );
}

/** Whether a board's name has all the words. */
export function nameMatches(name: string, words: string[]): boolean {
  const w = index(name);
  return words.length > 0 && words.every((q) => has(w, q));
}

// ---------- showing ----------

/** A text in pieces, the parts that match the words marked: drawn as elements, never as HTML. */
export function highlight(text: string, words: string[]): Piece[] {
  if (!words.length || !text) return text ? [{ text }] : [];
  const marks: [number, number][] = [];
  const mark = (start: number, token: string, q: string) => {
    // The shortest start of the word whose folded form covers what was typed (folding changes
    // lengths: "ß" is "ss", accents go).
    for (let k = 1; k <= token.length; k++) {
      const f = fold(token.slice(0, k).replace(/['’]/g, ''));
      if (f.length >= q.length && f.startsWith(q)) return void marks.push([start, start + k]);
    }
  };
  for (const m of text.matchAll(WORD)) {
    const f = fold(m[0].replace(/['’]/g, ''));
    for (const q of words) if (f.startsWith(q)) mark(m.index!, m[0], q);
  }
  for (const m of text.matchAll(JOINED)) {
    const f = fold(m[0].replace(/[-./]/g, ''));
    for (const q of words) if (f.startsWith(q) && !fold(m[0]).startsWith(q)) marks.push([m.index!, m.index! + m[0].length]);
  }
  for (const q of words) {
    if (!UNSPACED.test(q)) continue;
    const low = fold(text);
    for (let i = low.indexOf(q); i >= 0; i = low.indexOf(q, i + 1)) if (low.length === text.length) marks.push([i, i + q.length]);
  }
  if (!marks.length) return [{ text }];
  marks.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const m of marks) {
    const top = merged.at(-1);
    if (top && m[0] <= top[1]) top[1] = Math.max(top[1], m[1]);
    else merged.push([...m]);
  }
  const out: Piece[] = [];
  let at = 0;
  for (const [s, e] of merged) {
    if (s > at) out.push({ text: text.slice(at, s) });
    out.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** A short piece of a long text around its first match, with "…" where it was cut. */
export function snippet(text: string, words: string[], max = 110): Piece[] {
  const pieces = highlight(text, words);
  const first = pieces.findIndex((p) => p.hit);
  if (text.length <= max) return pieces;
  let pos = 0;
  for (let i = 0; i < first; i++) pos += pieces[i].text.length;
  let start = first < 0 ? 0 : Math.max(0, pos - 40);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space >= 0 && space < pos ? space + 1 : start;
  }
  let end = Math.min(text.length, start + max);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start + max / 2) end = space;
  }
  const out: Piece[] = [];
  let at = 0;
  for (const p of pieces) {
    const s = Math.max(at, start);
    const e = Math.min(at + p.text.length, end);
    if (e > s) out.push({ text: text.slice(s, e), ...(p.hit ? { hit: true } : {}) });
    at += p.text.length;
  }
  if (start > 0) out.unshift({ text: '…' });
  if (end < text.length) out.push({ text: '…' });
  return out;
}
