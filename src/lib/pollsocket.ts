// A board's sync for networks that let ordinary requests through but not WebSockets (some
// providers and proxies block or break them). It stands in for the WebSocket in sync.ts: the
// same messages go to POST /sync/http one at a time and the replies come back as if the board
// had sent them, with a check for changes now and then while the app is in front: every few
// seconds for the board on screen, less often for the others (less often still while nothing
// changes in them), and none while the app is hidden.

/** The board on screen. */
const FAST_MS = 4000;
/** Other boards: this often, doubling while nothing changes, up to the slowest. */
const SLOW_MS = 15_000;
const SLOWEST_MS = 120_000;

let focused: string | null = null;
const open = new Set<PollSocket>();

/** The board now on screen (null: none). Its checks speed up, starting with one now. */
export function focusPolling(board: string | null): void {
  if (focused === board) return;
  focused = board;
  for (const s of open) if (s.board === board) s.now();
}

export class PollSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  /** How far the checks for changes have got. Acks can run ahead of it, so it's kept here. */
  private since: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private polling = false;
  /** The wait before the next check while this board isn't on screen. */
  private wait = SLOW_MS;

  constructor(
    private url: string,
    readonly board: string,
    private token: string,
  ) {
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      open.add(this);
      this.onopen?.();
      this.later();
    });
  }

  send(data: string): void {
    if (this.readyState !== 1 || data === 'ping') return;
    const m = JSON.parse(data) as { t: string; since?: number };
    if (m.t === 'hello') {
      this.since ??= m.since ?? 0;
      return this.poll();
    }
    this.post(m);
  }

  close(): void {
    this.readyState = 3;
    open.delete(this);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Check now (the board came on screen). */
  now(): void {
    this.wait = SLOW_MS;
    this.poll();
  }

  private later(): void {
    if (this.readyState !== 1) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.poll();
      },
      this.board === focused ? FAST_MS : this.wait,
    );
  }

  private poll(): void {
    if (this.polling || this.readyState !== 1) return;
    if (this.since === null || (typeof document !== 'undefined' && document.hidden)) return this.later();
    this.polling = true;
    this.post({ t: 'hello', since: this.since }, (changed) => {
      this.polling = false;
      this.wait = changed ? SLOW_MS : Math.min(this.wait * 2, SLOWEST_MS);
      this.later();
    });
  }

  private post(m: { t: string; since?: number }, done?: (changed: boolean) => void): void {
    this.chain = this.chain.then(async () => {
      let changed = false;
      try {
        if (this.readyState !== 1) return;
        let res: Response;
        try {
          res = await fetch(this.url + '/sync/http', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
            body: JSON.stringify({ board: this.board, m }),
          });
        } catch {
          return this.end(1006);
        }
        if (res.status === 401) return this.end(4001);
        if (!res.ok) return this.end(1011);
        const { msgs } = (await res.json()) as { msgs: { t: string; rev?: number; done?: boolean; recs?: unknown[] }[] };
        for (const out of msgs) {
          if (this.readyState !== 1) return;
          if (out.t === 'changes' && out.recs?.length) changed = true;
          if (m.t === 'hello' && out.t === 'changes' && out.done && typeof out.rev === 'number') this.since = out.rev;
          this.onmessage?.({ data: JSON.stringify(out) });
        }
      } catch {
        this.end(1011);
      } finally {
        done?.(changed);
      }
    });
  }

  private end(code: number): void {
    if (this.readyState === 3) return;
    this.close();
    this.onclose?.({ code });
  }
}
