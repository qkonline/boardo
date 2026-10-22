import { MediaQuery } from 'svelte/reactivity';

/** Computer layout: side-panel sheets, hover actions. Matches the CSS breakpoint. */
export const desktop = new MediaQuery('(min-width: 768px)', false);

/** Svelte transitions run as Web Animations, which the CSS reduced-motion rule doesn't reach. */
export const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)', false);
