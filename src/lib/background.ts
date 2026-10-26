// A board's background as CSS: an image (from its short-lived link), a colour mixed softly into
// the page so it reads in light and dark, or nothing. Tiles on Boards use a stronger version.

import type { BoardRec, Hue } from '../../shared/model';
import { hueColor } from './hue';

export const bgImage = (b: BoardRec | null | undefined) =>
  b?.background && 'image' in b.background ? b.background.image : null;

/** Behind a board's columns. */
export function boardBackground(b: BoardRec | null | undefined, link: string | undefined): string | undefined {
  const bg = b?.background;
  if (!bg) return undefined;
  if ('hue' in bg) return `color-mix(in oklab, ${hueColor(bg.hue)} 22%, var(--bg))`;
  // In dark, a see-through dark veil over the picture keeps the board dim (--veil, app.css).
  return link ? `linear-gradient(var(--veil), var(--veil)), center / cover no-repeat url("${link}"), var(--bg)` : undefined;
}

/** The top of a board's tile on Boards: its background, or its colour when it has none. */
export function tileBackground(b: BoardRec | null | undefined, hue: Hue, link: string | undefined): string {
  const bg = b?.background;
  if (bg && 'image' in bg && link) return `center / cover no-repeat url("${link}")`;
  const c = hueColor(bg && 'hue' in bg ? bg.hue : hue);
  return `linear-gradient(135deg, ${c}, color-mix(in oklab, ${c} 55%, var(--raised)))`;
}
