import { MediaQuery } from 'svelte/reactivity';

/** Computer layout: side-panel sheets, hover actions. Matches the CSS breakpoint. */
export const desktop = new MediaQuery('(min-width: 768px)', false);

/** Svelte transitions run as Web Animations, which the CSS reduced-motion rule doesn't reach. */
export const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)', false);

/**
 * A row of tabs (`role="tablist"`) the arrow keys move along, Home and End to either end, choosing
 * as they go. Only the chosen tab is in the Tab order, the rest are reached with the arrows, as in
 * the ARIA tabs pattern.
 */
export function tabKeys(el: HTMLElement): () => void {
  const tabs = () => [...el.querySelectorAll<HTMLElement>('[role=tab]')];
  const roving = () => {
    const list = tabs();
    const chosen = list.find((t) => t.getAttribute('aria-selected') === 'true') ?? list[0];
    for (const t of list) t.tabIndex = t === chosen ? 0 : -1;
  };
  roving();
  const watch = new MutationObserver(roving);
  watch.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });
  const key = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const list = tabs();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? i + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? list.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    const t = list[(to + list.length) % list.length];
    t.focus();
    t.click();
  };
  el.addEventListener('keydown', key);
  return () => {
    watch.disconnect();
    el.removeEventListener('keydown', key);
  };
}
