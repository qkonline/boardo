// Keeping an installed copy current, as Elastic does. A Home Screen app can stay in memory for
// days, so it would keep running an old build. On coming back to the app (at most hourly) and
// every hour while it stays open, ask the server whether a newer build is out (update.ts). Once
// one is, reload for it at the next quiet moment: right away if the app has just come back or
// is out of sight and nothing is open on it, otherwise the next time it's hidden or shown.
//
// And pull to refresh: on a phone, pulling down from the top of what's on screen (past a point)
// reloads the app, which also picks up a newer build.

import { drag } from './drag.svelte';
import { app } from './store.svelte';
import { newBuildOut, reloadToUpdate } from './update';

const CHECK_MS = 60 * 60_000;
/** How far (px, after resistance) a pull has to go to refresh. */
export const PULL = 72;
const PULL_MAX = 110;
const DECIDE = 10;

class Freshness {
  pull = $state(0);
  pulling = $state(false);
  refreshing = $state(false);
  private ready = false;
  private checkedAt = Date.now();
  private reloading = false;

  /** Something is open or under way that a reload would interrupt. */
  private busy(): boolean {
    const typing = document.activeElement?.matches('input, textarea, select, [contenteditable]');
    const uploading = app.files.queue.length > 0 && app.online;
    // Changes this device couldn't store yet live only in this window: a reload would lose them.
    return !!(app.open || app.sheet || app.activity || drag.card || typing || uploading || app.hasUnsaved);
  }

  private reloadIfQuiet(): void {
    if (!this.ready || this.reloading || this.busy()) return;
    this.reloading = true;
    void reloadToUpdate();
  }

  private async check(returning: boolean): Promise<void> {
    this.checkedAt = Date.now();
    this.ready ||= await newBuildOut();
    if (returning || document.hidden) this.reloadIfQuiet();
  }

  /** Start watching. Returns the cleanup. */
  start(): () => void {
    const vis = () => {
      if (document.hidden) return this.reloadIfQuiet();
      if (this.ready) this.reloadIfQuiet();
      else if (Date.now() - this.checkedAt > CHECK_MS) void this.check(true);
    };
    document.addEventListener('visibilitychange', vis);
    const t = setInterval(() => void this.check(false), CHECK_MS);
    const stopPull = this.pullToRefresh(document.body);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      clearInterval(t);
      stopPull();
    };
  }

  /**
   * Touch events (not pointer events), since the browser keeps sending them while it scrolls, so
   * a pull can be told apart from a scroll as it happens. Only when whatever is under the finger,
   * and the page, are scrolled all the way up; never in a sheet, a field, or while a card is lifted.
   */
  private pullToRefresh(el: HTMLElement): () => void {
    let x0 = 0;
    let y0 = 0;
    let tracking = false;
    let mode: 'pull' | 'scroll' | null = null;
    let target: Element | null = null;

    const atTop = (from: Element | null) => {
      for (let n = from; n && n !== document.body; n = n.parentElement) if (n.scrollTop > 0) return false;
      return window.scrollY <= 0;
    };
    const start = (e: TouchEvent) => {
      tracking = false;
      if (e.touches.length !== 1 || this.refreshing || drag.card) return;
      target = e.target as Element;
      if (target.closest('input, textarea, select, [role=dialog], .drag-ghost')) return;
      tracking = true;
      mode = null;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    };
    const move = (e: TouchEvent) => {
      if (!tracking) return;
      if (drag.card || e.touches.length !== 1) return cancel();
      const dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (!mode) {
        if (Math.abs(dx) < DECIDE && Math.abs(dy) < DECIDE) return;
        mode = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.3 && atTop(target) ? 'pull' : 'scroll';
        this.pulling = mode === 'pull';
      }
      if (mode === 'pull') {
        if (e.cancelable) e.preventDefault();
        this.pull = Math.max(0, Math.min(PULL_MAX, dy * 0.5));
      }
    };
    const end = () => {
      if (!tracking) return;
      tracking = false;
      this.pulling = false;
      if (mode === 'pull' && this.pull >= PULL && app.hasUnsaved) {
        this.pull = 0;
        app.say("Not refreshing: some changes aren't saved on this device yet.");
      } else if (mode === 'pull' && this.pull >= PULL) {
        this.refreshing = true;
        this.pull = PULL;
        void reloadToUpdate();
      } else this.pull = 0;
      mode = null;
    };
    const cancel = () => {
      tracking = false;
      mode = null;
      this.pulling = false;
      if (!this.refreshing) this.pull = 0;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', cancel);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', cancel);
    };
  }
}

export const freshness = new Freshness();
