// A card's custom field values as words: on the card window and on cards (for the fields shown there).

import type { FieldRec } from '../../shared/model';
import { longDate } from './dates';

/** A field's value as words: dates as "Fri 24 Oct", a checkbox as Yes or No; null when empty. */
export function fieldText(f: FieldRec, v: string | number | boolean | null | undefined): string | null {
  if (v == null || v === '') return null;
  if (f.type === 'date' || f.type === 'datetime') return longDate(String(v));
  if (f.type === 'checkbox') return v ? 'Yes' : 'No';
  return String(v);
}
