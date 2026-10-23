// Dates on cards. A `date` value is a calendar date, 'YYYY-MM-DD'; a `datetime` value is ISO
// 8601 with the offset it was entered in. Either can be shown in the person's own time.

const DAY_MS = 24 * 3600_000;
const pad = (n: number) => String(n).padStart(2, '0');

export const hasTime = (v: unknown): boolean => typeof v === 'string' && v.includes('T');

/** The local calendar day a value falls on, 'YYYY-MM-DD'. */
export function dayOf(v: string): string {
  if (!hasTime(v)) return v.slice(0, 10);
  return keyOf(new Date(v));
}

export const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = (now = Date.now()) => keyOf(new Date(now));

/** A day key as a local Date at midnight. */
export function dateOf(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from `a` to `b` (keys). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / DAY_MS);
}

/**
 * The day before a due date, as a start date: a date, or with `withTime` a date and time (the
 * due time if it has one, 9:00 otherwise), in the person's own time.
 */
export function dayBefore(end: string, withTime: boolean): string | null {
  const d = dateOf(dayOf(end));
  d.setDate(d.getDate() - 1);
  if (!withTime) return keyOf(d);
  const at = hasTime(end) ? toLocalInput(end).slice(11) : '09:00';
  return fromLocalInput(`${keyOf(d)}T${at}`);
}

/** For a datetime-local field: the value in local time, 'YYYY-MM-DDTHH:mm'. */
export function toLocalInput(v: string | null | undefined): string {
  if (!v) return '';
  if (!hasTime(v)) return `${v}T09:00`;
  const d = new Date(v);
  return `${keyOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** From a datetime-local field: ISO 8601 with this device's offset. */
export function fromLocalInput(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${s.slice(0, 16)}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 5 pm, 5:30 pm */
export function clock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? ':' + pad(m) : ''} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}

/** "24 Oct", with the year when it isn't this year. */
export function shortDate(key: string, now = Date.now()): string {
  const d = dateOf(key);
  const year = d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

/** "Fri 24 Oct", or "Fri 24 Oct, 5 pm" for a value with a time. */
export function longDate(v: string, now = Date.now()): string {
  const key = dayOf(v);
  const d = dateOf(key);
  const base = `${DAYS[d.getDay()]} ${shortDate(key, now)}`;
  return hasTime(v) ? `${base}, ${clock(new Date(v))}` : base;
}

/** A card's dates in one line: "24 Oct to 28 Oct", "28 Oct", or '' without any. */
export function range(start: unknown, end: unknown, now = Date.now()): string {
  const s = typeof start === 'string' && start ? start : null;
  const e = typeof end === 'string' && end ? end : null;
  const one = (v: string) => shortDate(dayOf(v), now) + (hasTime(v) ? `, ${clock(new Date(v))}` : '');
  if (s && e) return dayOf(s) === dayOf(e) && !hasTime(s) ? one(e) : `${one(s)} to ${one(e)}`;
  return s ? one(s) : e ? one(e) : '';
}

/**
 * The deadline as a label (R8.10): Overdue, Due today (with the time), Due tomorrow, a weekday
 * within the next 6 days, otherwise a short date. Null without an end date (or a start date).
 */
export function deadline(end: unknown, now = Date.now()): { label: string; late: boolean; soon: boolean } | null {
  if (typeof end !== 'string' || !end) return null;
  const today = todayKey(now);
  const key = dayOf(end);
  const days = daysBetween(today, key);
  const at = hasTime(end) ? `, ${clock(new Date(end))}` : '';
  if (days < 0 || (hasTime(end) && new Date(end).getTime() < now)) return { label: 'Overdue', late: true, soon: false };
  if (days === 0) return { label: `Due today${at}`, late: false, soon: true };
  if (days === 1) return { label: `Due tomorrow${at}`, late: false, soon: true };
  if (days <= 6) return { label: `${LONG_DAYS[dateOf(key).getDay()]}${at}`, late: false, soon: false };
  return { label: shortDate(key, now) + at, late: false, soon: false };
}

/** When something happened, for logs and comments: "3:42 pm", "Yesterday, 3:42 pm", "21 Oct, 3:42 pm". */
export function when(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const days = daysBetween(keyOf(d), todayKey(now));
  if (days === 0) return clock(d);
  if (days === 1) return `Yesterday, ${clock(d)}`;
  return `${shortDate(keyOf(d), now)}, ${clock(d)}`;
}

/** A duration: "1h 20m", "40m", "under a minute". */
export function duration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'under a minute';
  const h = Math.floor(m / 60);
  return h ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
}
