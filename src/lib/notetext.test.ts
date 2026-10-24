import { describe, expect, it } from 'vitest';
import type { Note } from '../../shared/model';
import { ago, line } from './notetext';

const note = (extra: Partial<Note>): Note => ({
  id: 'n1',
  board: 'b1',
  card: 'k1',
  kind: 'mention',
  at: 0,
  read: false,
  by: { userId: 'tr', name: 'Tayyab Rehman', hue: 'cyan', photo: null },
  boardName: 'Spring launch',
  boardHue: 'cyan',
  title: 'Write the launch email',
  ...extra,
});
const NOW = new Date(2026, 9, 23, 15, 0).getTime();

describe('what an update says', () => {
  it('reads as a plain sentence for each kind', () => {
    expect(line(note({}))).toBe('Tayyab Rehman mentioned you in Write the launch email');
    expect(line(note({ kind: 'status', to: 'In progress' }))).toBe('Tayyab Rehman set Write the launch email to In progress');
    expect(line(note({ kind: 'completed', by: null }))).toBe('Write the launch email is completed. Everyone has done their part.');
    expect(line(note({ kind: 'due', to: '2026-10-30' }), NOW)).toBe('Tayyab Rehman moved the due date of Write the launch email to Fri 30 Oct');
    expect(line(note({ kind: 'due', to: null }))).toBe('Tayyab Rehman took the due date off Write the launch email');
    expect(line(note({ kind: 'unblocked', dep: 'Pick the colours', by: null }))).toBe('Pick the colours is done, so you can start Write the launch email');
    expect(line(note({ kind: 'added', card: null, to: 'member' }))).toBe('Tayyab Rehman added you to Spring launch as a member');
    expect(line(note({ kind: 'role', card: null, to: 'admin' }))).toBe('Tayyab Rehman made you an admin of Spring launch');
  });
  it('says how long ago, briefly', () => {
    expect(ago(NOW - 20_000, NOW)).toBe('Just now');
    expect(ago(NOW - 5 * 60_000, NOW)).toBe('5 min');
    expect(ago(NOW - 3 * 3600_000, NOW)).toBe('3 hr');
    expect(ago(new Date(2026, 9, 22, 9).getTime(), NOW)).toBe('Yesterday');
    expect(ago(new Date(2026, 9, 19, 9).getTime(), NOW)).toBe('Mon');
    expect(ago(new Date(2026, 8, 2).getTime(), NOW)).toBe('2 Sep');
  });
});
