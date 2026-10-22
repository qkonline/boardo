// Plain text with its links made clickable (R4.13). Nothing else in it is interpreted: the
// pieces are rendered as text, so no markup can get in.

export type Piece = { text: string; href?: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

export function linkify(s: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: m[0], href: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

/** Emoji for the comment box's picker, the ones people reach for most in a work chat. */
export const EMOJI = [
  '👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '🤝',
  '😀', '😂', '😊', '😍', '🤔', '😅', '😬', '😮',
  '😢', '😡', '🥳', '😴', '🤯', '🫡', '🙂', '😉',
  '✅', '❌', '⚠️', '❓', '❗', '💯', '🔥', '⭐',
  '🎉', '🚀', '💡', '📌', '📎', '📅', '⏰', '📝',
  '❤️', '💜', '💙', '💚', '💛', '🖤', '👋', '☕',
];
