// What the Worker and the board accept from people's devices. Every record is rebuilt from the
// fields it's allowed to have, so nothing else ever reaches storage.

import {
  type BoardRec,
  CLIENT_KINDS,
  type ColumnRec,
  type CommentRec,
  type CardRec,
  FIELD_TYPES,
  type FieldOption,
  type FieldRec,
  type Hue,
  HUES,
  type Kind,
  MAX_UPLOAD_MB,
} from '../../shared/model';

/** An email address as typed, tidied up, or null if it doesn't look like one. */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e) ? e : null;
}

export const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);

export function isHue(v: unknown, slate = false): v is Hue {
  if (typeof v !== 'string') return false;
  return (HUES as readonly string[]).includes(v) || (slate && v === 'slate') || /^#[0-9a-f]{6}$/i.test(v);
}

/** Plain text, trimmed of control characters (newlines kept where `lines`), at most `max` long. */
export function text(v: unknown, max: number, lines = false): string | null {
  if (typeof v !== 'string') return null;
  const t = lines ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '') : v.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return t.length <= max ? t : null;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export const LIMITS = {
  title: 300,
  desc: 20_000,
  comment: 5_000,
  name: 100,
  option: 60,
  options: 50,
  fields: 40,
  assignees: 50,
  deps: 50,
  value: 5_000,
  values: 60,
};

function board(d: Record<string, unknown>): BoardRec | null {
  const name = text(d.name, LIMITS.name)?.trim();
  if (!name || !isHue(d.hue)) return null;
  const mb = num(d.maxUploadMB) ? Math.round(d.maxUploadMB) : 30;
  if (mb < 1 || mb > MAX_UPLOAD_MB) return null;
  const out: BoardRec = { name, hue: d.hue, maxUploadMB: mb };
  const bg = d.background as Record<string, unknown> | null | undefined;
  if (bg != null) {
    if (typeof bg !== 'object') return null;
    if ('hue' in bg) {
      if (!isHue(bg.hue)) return null;
      out.background = { hue: bg.hue };
    } else if ('image' in bg) {
      if (!isId(bg.image)) return null;
      out.background = { image: bg.image };
    } else return null;
  }
  const nc = d.newCards as Record<string, unknown> | null | undefined;
  if (nc != null) {
    if (typeof nc !== 'object') return null;
    const pick = (v: unknown) => (v == null ? null : isId(v) ? v : undefined);
    const assignee = pick(nc.assignee);
    const status = pick(nc.status);
    if (assignee === undefined || status === undefined) return null;
    if (assignee || status) out.newCards = { assignee, status };
  }
  return out;
}

function column(key: string, d: Record<string, unknown>): ColumnRec | null {
  const name = text(d.name, LIMITS.name);
  if (name == null || d.id !== key || !num(d.order)) return null;
  return { id: key, name, order: d.order };
}

function option(o: unknown): FieldOption | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const label = text(r.label, LIMITS.option);
  if (!isId(r.id) || label == null || !isHue(r.hue, true)) return null;
  const out: FieldOption = { id: r.id, label, hue: r.hue };
  if (r.role === 'in_progress' || r.role === 'completed') out.role = r.role;
  return out;
}

function field(key: string, d: Record<string, unknown>): FieldRec | null {
  const name = text(d.name, LIMITS.name)?.trim();
  if (!name || d.id !== key || !num(d.order) || !FIELD_TYPES.includes(d.type as FieldRec['type'])) return null;
  const out: FieldRec = { id: key, name, type: d.type as FieldRec['type'], order: d.order };
  if (d.builtin === 'start' || d.builtin === 'end' || d.builtin === 'status') {
    if (d.builtin !== key) return null;
    out.builtin = d.builtin;
  } else if (d.builtin != null) return null;
  if (out.type === 'dropdown') {
    if (!Array.isArray(d.options) || d.options.length > LIMITS.options) return null;
    const opts = d.options.map(option);
    if (opts.some((o) => !o)) return null;
    const ids = new Set(opts.map((o) => o!.id));
    if (ids.size !== opts.length) return null;
    out.options = opts as FieldOption[];
  }
  return out;
}

/** A card's value for one field: a short string, a number, a boolean or null. */
function value(v: unknown): string | number | boolean | null | undefined {
  if (v === null || typeof v === 'boolean' || num(v)) return v;
  if (typeof v === 'string') return text(v, LIMITS.desc, true) ?? undefined;
  return undefined;
}

function card(key: string, d: Record<string, unknown>): CardRec | null {
  const title = text(d.title, LIMITS.title);
  const desc = text(d.desc ?? '', LIMITS.desc, true);
  if (d.id !== key || title == null || desc == null || !isId(d.columnId) || !num(d.order)) return null;
  if (!d.values || typeof d.values !== 'object' || Array.isArray(d.values)) return null;
  const values: CardRec['values'] = {};
  const entries = Object.entries(d.values as Record<string, unknown>);
  if (entries.length > LIMITS.values) return null;
  for (const [k, v] of entries) {
    if (!isId(k)) return null;
    const ok = value(v);
    if (ok === undefined) return null;
    if ((k === 'start' || k === 'end') && ok !== null && !(typeof ok === 'string' && (DATE.test(ok) || DATETIME.test(ok))))
      return null;
    if (ok !== null) values[k] = ok;
  }
  if (!Array.isArray(d.assignees) || d.assignees.length > LIMITS.assignees || !d.assignees.every(isId)) return null;
  const done: Record<string, number> = {};
  if (d.done != null) {
    if (typeof d.done !== 'object' || Array.isArray(d.done)) return null;
    for (const [u, at] of Object.entries(d.done as Record<string, unknown>)) {
      if (!isId(u) || !num(at)) return null;
      done[u] = at;
    }
  }
  if (!isId(d.createdBy) || !num(d.created)) return null;
  let deps: string[] | undefined;
  if (d.deps != null) {
    if (!Array.isArray(d.deps) || d.deps.length > LIMITS.deps || !d.deps.every(isId) || d.deps.includes(key)) return null;
    deps = [...new Set(d.deps as string[])];
  }
  return {
    id: key,
    columnId: d.columnId,
    order: d.order,
    title,
    desc,
    values,
    assignees: [...new Set(d.assignees as string[])],
    done,
    archived: !!d.archived,
    createdBy: d.createdBy,
    created: d.created,
    ...(deps?.length ? { deps } : {}),
  };
}

function comment(key: string, d: Record<string, unknown>): CommentRec | null {
  const body = text(d.text, LIMITS.comment, true);
  if (d.id !== key || body == null || !isId(d.cardId) || !isId(d.userId) || !num(d.at)) return null;
  const out: CommentRec = { id: key, cardId: d.cardId, userId: d.userId, text: body, at: d.at };
  if (num(d.editedAt)) out.editedAt = d.editedAt;
  if (d.deleted) {
    out.deleted = true;
    out.text = '';
  }
  return out;
}

export interface Change {
  kind: Kind;
  key: string;
  base: number;
  data: Record<string, unknown> | null;
}

const MAX_CHANGES = 200;

/**
 * The changes in a `put`, each checked and rebuilt, or null if the message is malformed. A
 * single record that doesn't pass (a kind devices can't write, a bad base or bad data) comes
 * back as `bad` and is refused on its own: the rest of the put still counts.
 */
export function changes(v: unknown): { list: Change[]; bad: Change[] } | null {
  if (!Array.isArray(v) || v.length > MAX_CHANGES) return null;
  const list: Change[] = [];
  const bad: Change[] = [];
  for (const c of v) {
    // Without a kind and key there's no record to answer for.
    if (!c || typeof c !== 'object' || typeof c.kind !== 'string' || !/^[a-z]{1,20}$/.test(c.kind) || !isId(c.key))
      return null;
    const raw = c.data;
    const refuse = () => bad.push({ kind: c.kind, key: c.key, base: 0, data: null });
    if (!CLIENT_KINDS.includes(c.kind) || !Number.isInteger(c.base) || c.base < 0) {
      refuse();
      continue;
    }
    if (raw === null) {
      list.push({ kind: c.kind, key: c.key, base: c.base, data: null });
      continue;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      refuse();
      continue;
    }
    const data = clean(c.kind, c.key, raw);
    (data ? list : bad).push({ kind: c.kind, key: c.key, base: c.base, data: data as Record<string, unknown> | null });
  }
  return { list, bad };
}

export function clean(kind: Kind, key: string, d: Record<string, unknown>): object | null {
  switch (kind) {
    case 'board':
      return key === 'main' ? board(d) : null;
    case 'column':
      return column(key, d);
    case 'field':
      return field(key, d);
    case 'card':
      return card(key, d);
    case 'comment':
      return comment(key, d);
  }
  return null;
}
