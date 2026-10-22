// Colours: one of the five named ones (and slate, for status values), or a custom #rrggbb.

import type { Hue } from '../../shared/model';

const SWATCH: Record<string, string> = {
  rose: '#f43f5e',
  yellow: '#facc15',
  lime: '#84cc16',
  cyan: '#22d3ee',
  indigo: '#818cf8',
  slate: '#94a3b8',
};

export const HUE_NAMES: Record<string, string> = {
  rose: 'Rose',
  yellow: 'Yellow',
  lime: 'Lime',
  cyan: 'Cyan',
  indigo: 'Indigo',
  slate: 'Slate',
};

/** The colour itself, for swatches, avatars and board marks. */
export const hueColor = (h: Hue | string | undefined): string => (h && SWATCH[h]) ?? (h?.startsWith('#') ? h : SWATCH.indigo);

/** For status values: the bar, the chip's tint and its text, readable in both themes. */
export function statusColors(h: Hue | string | undefined): { bar: string; tint: string; text: string } {
  if (h && h in SWATCH) return { bar: `var(--s-${h})`, tint: `var(--tint-${h})`, text: `var(--t-${h})` };
  const c = hueColor(h);
  return {
    bar: c,
    tint: `color-mix(in oklab, ${c} 16%, var(--raised))`,
    text: `color-mix(in oklab, ${c} 65%, var(--text))`,
  };
}

/** Dark or light text on top of a colour. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#16181d' : '#ffffff';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
