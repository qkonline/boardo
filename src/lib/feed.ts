// The board's Activity (Activity.svelte) as a feed: the log, newest first, by day; within a day,
// runs of one person's changes made close together, so their name shows once; within a run,
// the changes by card, so a card's name shows once.

import type { LogRec } from '../../shared/model';
import { clock, keyOf } from './dates';

export interface Run {
  /** Unique within the feed. */
  id: string;
  /** Who made the changes; null when they happened by themselves. */
  userId: string | null;
  newest: number;
  oldest: number;
  /** The changes by card (null: the board's own), the card changed most recently first. */
  cards: { cardId: string | null; logs: LogRec[] }[];
}

export interface Day {
  key: string;
  runs: Run[];
}

/** Changes further apart than this start a new run. */
const GAP_MS = 30 * 60_000;
/** Something that happened by itself (the completion rule) this soon after a person's change joins their run. */
const FOLLOW_MS = 60_000;

export function feed(logs: LogRec[]): Day[] {
  const days: Day[] = [];
  let run: Run | null = null;
  for (const l of logs) {
    const key = keyOf(new Date(l.at));
    let day = days.at(-1);
    if (day?.key !== key) {
      days.push((day = { key, runs: [] }));
      run = null;
    }
    const follows = run && run.oldest - l.at <= (l.userId == null ? FOLLOW_MS : GAP_MS);
    if (!run || !follows || (l.userId != null && run.userId !== l.userId)) {
      run = { id: l.id, userId: l.userId, newest: l.at, oldest: l.at, cards: [] };
      day.runs.push(run);
    }
    run.oldest = l.at;
    let group = run.cards.find((g) => g.cardId === l.cardId);
    if (!group) run.cards.push((group = { cardId: l.cardId, logs: [] }));
    group.logs.push(l);
  }
  return days;
}

/** A run's time: "6:51 am", or "6:43 to 6:51 am" when it spans more than a minute. */
export function span(run: Pick<Run, 'oldest' | 'newest'>): string {
  const to = clock(new Date(run.newest));
  if (run.newest - run.oldest < 60_000) return to;
  const from = clock(new Date(run.oldest));
  const half = (s: string) => s.slice(-2);
  return half(from) === half(to) ? `${from.slice(0, -3)} to ${to}` : `${from} to ${to}`;
}
