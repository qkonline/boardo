// Mentions in descriptions and comments: "@" and a person's name, as the picker writes it
// ("@Sara Ali"), or just their first name when only one person in the board has it ("@Sara").
// The text stays plain; who is meant is worked out against the board's people, the same way on
// the device (to show the mention) and on the board (to tell the person).

export interface Named {
  userId: string;
  name: string;
}

export interface Mention {
  /** Where "@" is, and just after the name. */
  start: number;
  end: number;
  userId: string;
}

const WORD = /[\p{L}\p{N}_]/u;

/** Every mention in `text`, in order. */
export function mentionsIn(text: string, people: Named[]): Mention[] {
  if (!text.includes('@') || !people.length) return [];
  const full = people
    .map((p) => ({ userId: p.userId, key: p.name.trim().toLowerCase() }))
    .filter((p) => p.key)
    .sort((a, b) => b.key.length - a.key.length);
  const firsts = new Map<string, string | null>();
  for (const p of full) {
    const first = p.key.split(/\s+/)[0];
    firsts.set(first, firsts.has(first) && firsts.get(first) !== p.userId ? null : p.userId);
  }
  const lower = text.toLowerCase();
  const out: Mention[] = [];
  for (let i = lower.indexOf('@'); i >= 0; i = lower.indexOf('@', i + 1)) {
    // Not in the middle of a word or an email address.
    if (i > 0 && WORD.test(text[i - 1])) continue;
    const after = (n: number) => i + 1 + n >= text.length || !WORD.test(text[i + 1 + n]);
    const hit =
      full.find((p) => lower.startsWith(p.key, i + 1) && after(p.key.length)) ??
      [...firsts].filter(([, id]) => id).map(([k, id]) => ({ key: k, userId: id! })).find((p) => lower.startsWith(p.key, i + 1) && after(p.key.length));
    if (hit) {
      out.push({ start: i, end: i + 1 + hit.key.length, userId: hit.userId });
      i += hit.key.length;
    }
  }
  return out;
}

/** The people mentioned in `text`. */
export const mentioned = (text: string, people: Named[]): Set<string> => new Set(mentionsIn(text, people).map((m) => m.userId));

/** The line of `text` holding a mention of `userId`, trimmed, for an update to quote. */
export function mentionLine(text: string, userId: string, people: Named[], max = 140): string {
  const m = mentionsIn(text, people).find((x) => x.userId === userId);
  const at = m ? m.start : 0;
  const from = text.lastIndexOf('\n', at) + 1;
  const to = text.indexOf('\n', at);
  const line = text.slice(from, to < 0 ? undefined : to);
  // A long line is quoted from a little before the mention.
  const lead = at - from > max / 3 ? at - from - 20 : 0;
  return clip((lead ? '…' : '') + line.slice(lead).trim(), max);
}

export const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);
