import type { Board } from './board';

export interface Env {
  DB: D1Database;
  BOARDS: DurableObjectNamespace<Board>;
  FILES: R2Bucket;
  /** Comma-separated origins allowed to call this Worker. */
  ALLOWED_ORIGINS: string;
  /** Where the app lives, for links in emails, e.g. https://kaiserkhan.com/boardo/ */
  APP_URL: string;
  /** Who emails come from, e.g. "Boardo <boardo@kaiserkhan.com>". */
  MAIL_FROM: string;
  /** Resend's API key (a secret). Without it, mail is only logged (local development). */
  RESEND_API_KEY?: string;
  /** Signs short-lived file links (a secret). */
  FILE_SIGNING_KEY?: string;
  /** Requests per network to the routes that need no sign-in. Absent in tests. */
  LIMITER?: RateLimit;
  /** Local development only: keep sent mail so tests can read the codes (`/dev/mail`). */
  DEV_MAIL?: string;
  /** Elastic's Worker (a service binding): told whose cards changed. Absent in tests. */
  ELASTIC?: { cardsChanged(accounts: string[]): Promise<void> };
}
