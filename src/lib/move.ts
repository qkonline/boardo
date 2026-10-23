// Moving the app to a new address (October 2026: kaiserkhan.com/boardo/ → boardo.kaiserkhan.com).
// Browsers keep each address's storage apart, so the copy at the old address carries over what
// the new one can't see: its sign-in, as a one-time code from the Worker good for two minutes,
// and this device's own settings. Both go in the fragment, which is never sent to a server.
// Before it goes, everything changed here reaches the boards (App.moveHome()). As in Elastic.

import type { Theme } from './store.svelte';

/** Set in the last build left at the old address: where the app is now. */
export const MOVED_TO: string = import.meta.env.VITE_MOVED_TO ?? '';

/** This device's own settings (everything else comes from the boards). */
export interface Carried {
  theme?: Theme;
  /** "Don't ask" was chosen for adding a passkey. */
  passkeyAsk?: 'no';
}

function carried(raw: Record<string, unknown>): Carried {
  const out: Carried = {};
  if (raw.theme === 'auto' || raw.theme === 'light' || raw.theme === 'dark') out.theme = raw.theme;
  if (raw.passkeyAsk === 'no') out.passkeyAsk = 'no';
  return out;
}

/** The new address, with the sign-in's one-time code (if signed in) and this device's settings. */
export function moveUrl(code: string | null, d: Carried): string {
  const q = new URLSearchParams({ d: JSON.stringify(d) });
  if (code) q.set('handoff', code);
  return `${MOVED_TO}#${q}`;
}

/** Arriving from the old address: what it sent, taken off the address bar at once. */
export function arrival(): { code: string | null; settings: Carried } | null {
  if (typeof location === 'undefined' || !/[#&](handoff|d)=/.test(location.hash)) return null;
  const q = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  let settings: Carried = {};
  try {
    settings = carried(JSON.parse(q.get('d') ?? '{}'));
  } catch {
    /* nothing usable */
  }
  return { code: q.get('handoff'), settings };
}

/** Opened from the Home Screen: that icon keeps the old address, so it needs adding again. */
export const installed = () =>
  typeof window !== 'undefined' &&
  (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
