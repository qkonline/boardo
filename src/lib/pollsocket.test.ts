// How often boards syncing over requests check for changes (pollsocket.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusPolling, PollSocket } from './pollsocket';

let asked: string[];
let made: PollSocket[] = [];
let hidden = false;
let changes = false;

beforeEach(() => {
  vi.useFakeTimers();
  asked = [];
  hidden = false;
  changes = false;
  vi.stubGlobal('document', {
    get hidden() {
      return hidden;
    },
  });
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { board } = JSON.parse(init.body);
    asked.push(board);
    return new Response(JSON.stringify({ msgs: [{ t: 'changes', recs: changes ? [{}] : [], rev: 1, done: true }] }));
  });
  focusPolling(null);
});

afterEach(() => {
  for (const s of made) s.close();
  made = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Let requests on their way finish. */
async function settle() {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
}

async function open(board: string) {
  const s = new PollSocket('https://x', board, 't');
  made.push(s);
  await settle();
  s.send(JSON.stringify({ t: 'hello', since: 0 }));
  await settle();
  return s;
}
const count = (b: string) => asked.filter((x) => x === b).length;

describe('checking for changes over requests', () => {
  it('checks the board on screen every 4 s, and the others less and less while nothing changes', async () => {
    await open('a');
    await open('b');
    focusPolling('a');
    await settle();
    asked = [];
    await vi.advanceTimersByTimeAsync(120_000);
    expect(count('a')).toBeGreaterThanOrEqual(28);
    // Nothing came with the first check: 30 s, then 60 more, so two in two minutes.
    expect(count('b')).toBe(2);
  });

  it('checks a board at once when it comes on screen', async () => {
    await open('a');
    asked = [];
    focusPolling('a');
    await settle();
    expect(count('a')).toBe(1);
  });

  it('keeps a busy board at the shorter wait', async () => {
    changes = true;
    await open('b');
    asked = [];
    await vi.advanceTimersByTimeAsync(120_000);
    expect(count('b')).toBe(8);
  });

  it('never checks while the app is hidden', async () => {
    await open('a');
    focusPolling('a');
    hidden = true;
    await settle();
    asked = [];
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toEqual([]);
    hidden = false;
    await vi.advanceTimersByTimeAsync(4000);
    expect(count('a')).toBe(1);
  });
});
