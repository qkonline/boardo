import { describe, expect, it } from 'vitest';
import { fieldName, type LogRec } from '../../shared/model';
import type { BoardState } from './board.svelte';
import { logText } from './logtext';

// Only what these lines read: the board's people and cards.
const b = { member: new Map([['ann', { name: 'Ann Lee' }]]), card: new Map() } as unknown as BoardState;
const log = (action: LogRec['action'], detail: LogRec['detail']): LogRec => ({ id: 'l1', cardId: 'k1', userId: 'ann', at: 0, action, detail });

describe('how a log line names things', () => {
  it('calls the end date the due date, as the card does, unless an admin renamed it', () => {
    expect(fieldName({ builtin: 'end', name: 'End date' })).toBe('Due date');
    expect(fieldName({ builtin: 'end', name: 'Deadline' })).toBe('Deadline');
    expect(fieldName({ builtin: 'start', name: 'Start date' })).toBe('Start date');
    expect(fieldName({ name: 'End date' })).toBe('End date');
    expect(logText(log('changed', { field: 'end', name: 'End date', from: null, to: 'Thu 29 Oct' }), b, true)).toBe('set Due date to Thu 29 Oct');
    expect(logText(log('changed', { field: 'end', name: 'End date', from: 'Thu 29 Oct', to: null }), b, true)).toBe('cleared Due date');
  });
  it('says someone added themselves to a card in plain words', () => {
    expect(logText(log('assigned', { user: 'ann' }), b, true)).toBe('added themselves to this card');
    expect(logText(log('assigned', { user: 'bob' }), b, true)).toBe('assigned this card to someone who left');
  });
});
