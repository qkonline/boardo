// A board's sync for networks that let ordinary requests through but not WebSockets (some
// providers and proxies block or break them). It stands in for the WebSocket in sync.ts: the
// same messages go to POST /sync/http one at a time and the replies come back as if the board
// had sent them, with a check for changes every few seconds while the app is in front.

const POLL_MS = 4000;

export class PollSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  /** How far the checks for changes have got. Acks can run ahead of it, so it's kept here. */
  private since: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private polling = false;

  constructor(
    private url: string,
    private board: string,
    private token: string,
  ) {
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.();
      this.timer = setInterval(() => this.poll(), POLL_MS);
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
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private poll(): void {
    if (this.polling || this.since === null || (typeof document !== 'undefined' && document.hidden)) return;
    this.polling = true;
    this.post({ t: 'hello', since: this.since }, () => (this.polling = false));
  }

  private post(m: { t: string; since?: number }, done?: () => void): void {
    this.chain = this.chain.then(async () => {
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
        const { msgs } = (await res.json()) as { msgs: { t: string; rev?: number; done?: boolean }[] };
        for (const out of msgs) {
          if (this.readyState !== 1) return;
          if (m.t === 'hello' && out.t === 'changes' && out.done && typeof out.rev === 'number') this.since = out.rev;
          this.onmessage?.({ data: JSON.stringify(out) });
        }
      } catch {
        this.end(1011);
      } finally {
        done?.();
      }
    });
  }

  private end(code: number): void {
    if (this.readyState === 3) return;
    this.close();
    this.onclose?.({ code });
  }
}
