// Light formatting for descriptions and comments. The text stays plain, with a few marks people
// may know from chat apps: **bold**, *italic* (or _italic_), ~~struck through~~, and lines that
// start with "- " or "1. " as lists. `blocks()` reads them for showing; the result is rendered as
// elements, never as HTML, so nothing typed can get into the page. `mark()` and `list()` are
// what the toolbar does to a text box: they add the marks around a selection, or take them away.

import { linkify } from './text';

export type Inline = { text: string; href?: string; b?: boolean; i?: boolean; s?: boolean };
export type Block = { kind: 'p'; lines: Inline[][] } | { kind: 'ul'; items: Inline[][] } | { kind: 'ol'; start: number; items: Inline[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,4})[.)]\s+(.*)$/;

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  for (const line of text.split('\n')) {
    const bullet = BULLET.exec(line);
    const number = bullet ? null : NUMBER.exec(line);
    if (bullet) {
      if (cur?.kind !== 'ul') out.push((cur = { kind: 'ul', items: [] }));
      cur.items.push(inline(bullet[1]));
    } else if (number) {
      if (cur?.kind !== 'ol') out.push((cur = { kind: 'ol', start: Number(number[1]), items: [] }));
      cur.items.push(inline(number[2]));
    } else if (!line.trim()) {
      cur = null;
    } else {
      if (cur?.kind !== 'p') out.push((cur = { kind: 'p', lines: [] }));
      cur.lines.push(inline(line));
    }
  }
  return out;
}

/** The marks, outermost first; each pair holds at least one character and doesn't start or end on a space. */
const MARKS: [RegExp, 'b' | 'i' | 's'][] = [
  // Bold closes on the last two of a run of stars, so ***both*** is bold around italic.
  [/\*\*(?=\S)([^\n]*?\S)\*\*(?!\*)/, 'b'],
  [/~~(?=\S)([^\n]*?\S)~~/, 's'],
  [/(?<!\*)\*(?=[^\s*])((?:[^*\n]*?[^\s*])?)\*(?!\*)/, 'i'],
  [/(?<![\p{L}\p{N}_])_(?=[^\s_])((?:[^_\n]*?[^\s_])?)_(?![\p{L}\p{N}_])/u, 'i'],
];
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]*~_]/gi;

/** One line's pieces. Web addresses are hidden from the marks, so an underscore in one stays put. */
export function inline(s: string, flags: Omit<Inline, 'text' | 'href'> = {}): Inline[] {
  const masked = s.replace(URL_RE, (u) => '\uE000'.repeat(u.length));
  let best: { at: number; len: number; inner: string; flag: 'b' | 'i' | 's' } | null = null;
  for (const [re, flag] of MARKS) {
    const m = re.exec(masked);
    if (m && (!best || m.index < best.at)) {
      const open = flag === 'i' ? 1 : 2;
      best = { at: m.index, len: m[0].length, inner: s.slice(m.index + open, m.index + m[0].length - open), flag };
    }
  }
  if (!best) return linkify(s).map((p) => ({ ...flags, ...p }));
  return [
    ...(best.at ? inline(s.slice(0, best.at), flags) : []),
    ...inline(best.inner, { ...flags, [best.flag]: true }),
    ...inline(s.slice(best.at + best.len), flags),
  ];
}

/** The words alone, marks and list markers taken off, on one line: a description's preview on its card. */
export function plain(text: string): string {
  return blocks(text)
    .flatMap((bl) => (bl.kind === 'p' ? bl.lines : bl.items))
    .map((l) => l.map((p) => p.text).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Edit = { value: string; start: number; end: number };

/**
 * Bold, italic or struck through on the selection, or off if it already has it. With nothing
 * selected, the pair goes in with the cursor between. Each line is marked on its own, since the
 * marks don't cross lines, and spaces at the edges stay outside them.
 */
export function mark(value: string, start: number, end: number, kind: 'b' | 'i' | 's'): Edit {
  const m = kind === 'b' ? '**' : kind === 'i' ? '*' : '~~';
  if (start === end) {
    const off = around(value, start, end, kind);
    if (off) return off;
    return { value: value.slice(0, start) + m + m + value.slice(end), start: start + m.length, end: start + m.length };
  }
  const off = around(value, start, end, kind) ?? inside(value, start, end, kind);
  if (off) return off;
  const parts = value.slice(start, end).split('\n').map((line) => {
    const lead = line.match(/^\s*/)![0];
    const trail = line.match(/\s*$/)![0];
    const body = line.slice(lead.length, line.length - trail.length);
    return body ? lead + m + body + m + trail : line;
  });
  const sel = parts.join('\n');
  // One line: keep the words selected, inside the marks, so pressing again takes them off.
  if (parts.length === 1 && sel !== value.slice(start, end)) {
    const lead = sel.match(/^\s*/)![0].length + m.length;
    const body = sel.trim().length - m.length * 2;
    return { value: value.slice(0, start) + sel + value.slice(end), start: start + lead, end: start + lead + body };
  }
  return { value: value.slice(0, start) + sel + value.slice(end), start, end: start + sel.length };
}

/** Stars on one side of a point: one is italic, two bold, three both. */
const stars = (s: string) => s.match(/\*{0,3}$/)![0].length;

/** The marks sit just outside the selection: take them away. */
function around(value: string, start: number, end: number, kind: 'b' | 'i' | 's'): Edit | null {
  const before = value.slice(0, start);
  const after = value.slice(end);
  if (kind === 's') {
    if (!before.endsWith('~~') || !after.startsWith('~~')) return null;
    return { value: before.slice(0, -2) + value.slice(start, end) + after.slice(2), start: start - 2, end: end - 2 };
  }
  const l = stars(before);
  const r = [...after].findIndex((c) => c !== '*');
  const rs = Math.min(3, r === -1 ? after.length : r);
  const n = Math.min(l, rs);
  const has = kind === 'b' ? n >= 2 : n === 1 || n === 3;
  if (!has) return null;
  const cut = kind === 'b' ? 2 : 1;
  return { value: before.slice(0, -cut) + value.slice(start, end) + after.slice(cut), start: start - cut, end: end - cut };
}

/** The selection itself starts and ends with the marks: take them away. */
function inside(value: string, start: number, end: number, kind: 'b' | 'i' | 's'): Edit | null {
  const sel = value.slice(start, end);
  const m = kind === 'b' ? '**' : kind === 'i' ? '*' : '~~';
  if (sel.length < m.length * 2 + 1 || !sel.startsWith(m) || !sel.endsWith(m)) return null;
  if (kind === 'i' && (sel.startsWith('**') !== sel.startsWith('***') || sel.endsWith('**') !== sel.endsWith('***'))) return null;
  const inner = sel.slice(m.length, -m.length);
  return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
}

/** Make the selected lines a bulleted or numbered list, or plain lines again if they already are one. */
export function list(value: string, start: number, end: number, kind: 'ul' | 'ol'): Edit {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  let to = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
  if (to === -1) to = value.length;
  const lines = value.slice(from, to).split('\n');
  const strip = (l: string) => l.replace(BULLET, '$1').replace(NUMBER, '$2');
  const filled = lines.filter((l) => l.trim());
  const already = filled.length > 0 && filled.every((l) => (kind === 'ul' ? BULLET.test(l) : NUMBER.test(l)));
  let n = 0;
  const next = lines.map((l) => {
    if (already) return strip(l);
    if (!l.trim() && lines.length > 1) return l;
    return (kind === 'ul' ? '- ' : `${++n}. `) + strip(l);
  });
  const body = next.join('\n');
  const caret = start === end && lines.length === 1 ? from + body.length : null;
  return { value: value.slice(0, from) + body + value.slice(to), start: caret ?? from, end: caret ?? from + body.length };
}

/** Enter inside a list item: the next item, or the end of the list when this one is empty. */
export function enter(value: string, at: number): Edit | null {
  const from = value.lastIndexOf('\n', at - 1) + 1;
  const line = value.slice(from, at);
  const bullet = /^(\s*[-*•]\s+)(.*)$/.exec(line);
  const number = bullet ? null : /^(\s*)(\d{1,4})([.)]\s+)(.*)$/.exec(line);
  if (!bullet && !number) return null;
  const rest = bullet ? bullet[2] : number![4];
  if (!rest.trim() && value.slice(at, value.indexOf('\n', at) === -1 ? undefined : value.indexOf('\n', at)).trim() === '') {
    return { value: value.slice(0, from) + value.slice(at), start: from, end: from };
  }
  const prefix = bullet ? bullet[1] : `${number![1]}${Number(number![2]) + 1}${number![3]}`;
  const ins = '\n' + prefix;
  return { value: value.slice(0, at) + ins + value.slice(at), start: at + ins.length, end: at + ins.length };
}
