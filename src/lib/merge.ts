// Combining two versions of a record changed by two people at once (R9.5). `base` is the last
// version both had, `mine` this device's, `theirs` the board's. Whatever this device changed
// since `base` wins, and whatever it left alone takes the board's version, field by field. A
// card's values and parts are merged field by field too, so two people filling in different
// fields of the same card both keep their change.

import type { CardRec, Kind } from '../../shared/model';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Field by field. Without a base (never agreed before), mine wins where they differ. */
export function fields<T extends object>(base: T | null, mine: T, theirs: T): T {
  const out = { ...theirs } as Record<string, unknown>;
  const b = base as Record<string, unknown> | null;
  const m = mine as Record<string, unknown>;
  for (const k of Object.keys(m)) if (!b || !same(m[k], b[k])) out[k] = m[k];
  // A field mine dropped since the base goes, unless theirs changed it.
  if (b) for (const k of Object.keys(b)) if (!(k in m) && same(out[k], b[k])) delete out[k];
  return out as T;
}

/** Lists merged as sets: what either side added since the base is in, what either removed is out. */
function sets<T>(base: T[] | null, mine: T[], theirs: T[]): T[] {
  const b = new Set(base ?? []);
  const out = theirs.filter((x) => mine.includes(x) || !b.has(x));
  for (const x of mine) if (!out.includes(x) && (!b.has(x) || theirs.includes(x))) out.push(x);
  return out;
}

export function mergeCard(base: CardRec | null, mine: CardRec, theirs: CardRec): CardRec {
  const top = fields(base, mine, theirs);
  const deps = sets(base?.deps ?? null, mine.deps ?? [], theirs.deps ?? []);
  const out: CardRec = {
    ...top,
    values: fields(base?.values ?? null, mine.values, theirs.values),
    done: fields(base?.done ?? null, mine.done, theirs.done),
    assignees: sets(base?.assignees ?? null, mine.assignees, theirs.assignees),
  };
  if (deps.length) out.deps = deps;
  else delete out.deps;
  return out;
}

/** Merge a record changed both here and on the board. Mine wins over a deletion. */
export function merge(kind: Kind, base: unknown, mine: unknown, theirs: unknown): unknown {
  if (mine == null) return same(theirs, base) ? null : theirs;
  if (theirs == null) return mine;
  if (kind === 'card') return mergeCard(base as CardRec | null, mine as CardRec, theirs as CardRec);
  return fields(base as object | null, mine as object, theirs as object);
}
