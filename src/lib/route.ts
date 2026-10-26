// Each place in Boardo has its own address, so it can be bookmarked, shared, opened in a new tab,
// and Back and Forward move between places:
//   /                                Boards
//   /my-cards                        My cards
//   /account                         Account
//   /b/<board>/<name>                a board (the name is only there to read; it may change)
//   /b/<board>/<name>/settings       its settings
//   /b/<board>/<name>/c/<card>       a card open on it
// The app is one page: the Worker serves it for these paths, and the store reads the address.

import type { Screen } from './store.svelte';

export interface Route {
  screen: Screen;
  card: { board: string; id: string } | null;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A board's name as it shows in its address: "MSc Computer Science" is msc-computer-science. */
export function slug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  // Never one of the words the address uses for something else.
  return s === 'settings' || s === 'c' ? `${s}-board` : s;
}

/** The address of a place. `nameOf` gives a board's name, for the readable part. */
export function pathOf(screen: Screen, card: Route['card'], nameOf: (board: string) => string | undefined): string {
  const board = (id: string) => {
    const s = slug(nameOf(id) ?? '');
    return `/b/${id}${s ? '/' + s : ''}`;
  };
  if (card) return `${board(card.board)}/c/${card.id}`;
  switch (screen.name) {
    case 'home':
      return '/';
    case 'mycards':
      return '/my-cards';
    case 'settings':
      return '/account';
    case 'board':
      return board(screen.id);
    case 'boardSettings':
      return `${board(screen.id)}/settings`;
  }
}

/** The place an address names, or null for Boards' address and anything Boardo doesn't know. */
export function parsePath(pathname: string): Route | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 1 && parts[0] === 'my-cards') return { screen: { name: 'mycards' }, card: null };
  if (parts.length === 1 && parts[0] === 'account') return { screen: { name: 'settings' }, card: null };
  if (parts[0] !== 'b' || !ID.test(parts[1] ?? '')) return null;
  const id = parts[1];
  const rest = parts.slice(2);
  if (rest.length >= 2 && rest.at(-2) === 'c' && ID.test(rest.at(-1)!))
    return { screen: { name: 'board', id }, card: { board: id, id: rest.at(-1)! } };
  if (rest.at(-1) === 'settings') return { screen: { name: 'boardSettings', id }, card: null };
  return { screen: { name: 'board', id }, card: null };
}

/** The same place, whatever its readable part says: moving between two such is a replace, not a step. */
export function samePlace(a: string, b: string): boolean {
  const key = (p: string) => {
    const r = parsePath(p);
    if (!r) return p === '/' ? 'home' : p;
    return JSON.stringify([r.screen, r.card]);
  };
  return key(a) === key(b);
}

/** The window's title for a place. */
export function titleOf(screen: Screen, cardTitle: string | undefined, nameOf: (board: string) => string | undefined): string {
  const place =
    cardTitle != null
      ? cardTitle || 'Untitled'
      : screen.name === 'mycards'
        ? 'My cards'
        : screen.name === 'settings'
          ? 'Account'
          : screen.name === 'board'
            ? nameOf(screen.id)
            : screen.name === 'boardSettings'
              ? `${nameOf(screen.id) ?? 'Board'} settings`
              : 'Boards';
  return place ? `${place} · Boardo` : 'Boardo';
}
