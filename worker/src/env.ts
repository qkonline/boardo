import type { Board } from './board';

export interface Env {
  DB: D1Database;
  BOARDS: DurableObjectNamespace<Board>;
  FILES: R2Bucket;
  /** The passkey site for this domain and its subdomains (kaiserkhan.com). */
  RP_ID?: string;
  /** Comma-separated origins allowed to call this Worker. */
  ALLOWED_ORIGINS: string;
  /** The app's local origins (Vite, previews, Elastic's dev copies): honoured only in local development (`isDev`). */
  DEV_ORIGINS?: string;
  /**
   * The app's old address (kaiserkhan.com, www), whose farewell build hands each copy over: it
   * may call only what that needs (`FAREWELL` in index.ts).
   */
  LEGACY_ORIGINS?: string;
  /** Where the app lives, for links in emails and the passkey origin, e.g. https://boardo.kaiserkhan.com/ */
  APP_URL: string;
  /** Who emails come from, e.g. "Boardo <boardo@kaiserkhan.com>". */
  MAIL_FROM: string;
  /** Resend's API key (a secret). Without it, mail is only logged (local development). */
  RESEND_API_KEY?: string;
  /** Signs short-lived file links (a secret). */
  FILE_SIGNING_KEY?: string;
  /** Requests per network to the routes that need no sign-in. Absent in tests. */
  LIMITER?: RateLimit;
  /** Requests per signed-in person to the routes that write. Absent in tests. */
  USER_LIMITER?: RateLimit;
  /** Cloudflare Turnstile on asking for a sign-in code: on only when both are set (auth.ts). */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** Alerts on phones and computers (Web Push, as in Elastic): the public key, the private one (a secret), and a contact. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /**
   * Local development only (worker/.dev.vars): keep sent mail so tests can read the codes
   * (`/dev/mail`). It also marks the Worker as running locally (`isDev`), which lets the local
   * origins and Elastic's local addresses in.
   */
  DEV_MAIL?: string;
  /** Elastic's Worker (a service binding): told whose cards changed. Absent in tests. */
  ELASTIC?: { cardsChanged(accounts: string[]): Promise<void> };
  /** The built app's files (wrangler.toml [assets]). Absent in tests. */
  ASSETS?: Fetcher;
}

/** Running locally (`wrangler dev` with worker/.dev.vars), never live. */
export const isDev = (env: Pick<Env, 'DEV_MAIL'>) => !!env.DEV_MAIL;

/** A comma-separated list from a setting. */
export const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
