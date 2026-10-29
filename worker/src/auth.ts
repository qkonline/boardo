// Signing in by email. Someone types their address, gets a six-digit code by email and types it
// in; that gives the device a session token, which it sends with every request. A new address
// makes a new account. Only hashes of tokens and codes are stored.

import { cleanEmail, isHue } from './checks';
import type { Env } from './env';
import { MailSpent, sendMail } from './mail';
import { LINK, linksGone } from './notify';
import { Refusal } from './refusal';

export { Refusal };

export interface User {
  id: string;
  email: string;
  name: string | null;
  hue: string;
  photo: string | null;
}

const CODE_MS = 10 * 60_000;
const CODE_GAP_MS = 60_000;
const CODE_TRIES = 5;
/** Codes per address, and per network, per hour. */
const PER_EMAIL = 6;
const PER_IP = 30;
/** Tries at codes for one address in a day, whatever the network: guessing stays hopeless. */
const TRIES_A_DAY = 30;
/** Asking to change one's email, per account, per hour. */
const CHANGES_AN_HOUR = 5;
/** A device that hasn't been used for this long is signed out. */
const SESSION_IDLE_MS = 365 * 24 * 3600_000;
export const DAY_MS = 24 * 3600_000;
const HOUR_MS = 3600_000;

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/** Six digits, evenly spread. */
export function sixDigits(): string {
  const max = 4_294_000_000; // a multiple of 10^6 below 2^32, so no digit is favoured
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    if (n < max) return String(n % 1_000_000).padStart(6, '0');
  }
}

/** Whether two strings are the same, taking as long whichever character differs (hashes, signatures). */
export function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * The network a request comes from, for limits per network: an IPv4 address as it is, and an
 * IPv6 one as its /64, since one home or phone is given a whole /64 and can pick any address in it.
 */
export function network(ip: string): string {
  const v4 = ip.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip;
  const [l, r] = ip.toLowerCase().split('%')[0].split('::');
  const left = l ? l.split(':') : [];
  const right = r ? r.split(':') : [];
  const groups = r === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g || '0', 16).toString(16))
    .join(':')}::/64`;
}

/**
 * Count one use of `key` in a window (an hour unless said); false once it's over `max`. Rate
 * limits for sending codes, per address and per network, and the day's email.
 */
export async function withinLimit(env: Env, key: string, max: number, now = Date.now(), windowMs = HOUR_MS): Promise<boolean> {
  // One statement, so many requests at once can't all read the count before any adds to it.
  const row = await env.DB.prepare(
    `INSERT INTO limits (key, count, start) VALUES (?1, 1, ?2)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN ?2 - start > ?3 THEN 1 ELSE count + 1 END,
       start = CASE WHEN ?2 - start > ?3 THEN ?2 ELSE start END
     RETURNING count`,
  )
    .bind(key, now, windowMs)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= max;
}

/**
 * Spend a try on a code and, when it's the right one, use it up. Each step is one statement, so
 * asking many times at once can't get past the tries or use one code twice.
 */
async function takeCode(env: Env, key: string, hash: string): Promise<boolean> {
  const row = await env.DB.prepare('UPDATE email_codes SET tries = tries + 1 WHERE email = ? AND tries < ? AND expires >= ? RETURNING hash')
    .bind(key, CODE_TRIES, Date.now())
    .first<{ hash: string }>();
  if (!row) return false;
  // Only tries at a code that was sent count for the day, so guesses at an address with no code
  // waiting can't lock its owner out.
  if (!(await withinLimit(env, `tries:${key}`, TRIES_A_DAY, Date.now(), DAY_MS)))
    throw new Refusal(429, 'Too many tries for this email today. Try again tomorrow.');
  if (!same(row.hash, hash)) return false;
  return !!(await env.DB.prepare('DELETE FROM email_codes WHERE email = ? AND hash = ? RETURNING 1').bind(key, hash).first());
}

// ---------- sessions ----------

export async function newSession(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (hash, user_id, created, used) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now)
    .run();
  return token;
}

/** Whose session this token is, or null. */
export async function sessionUser(env: Env, token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !token || token.length > 100) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare('SELECT user_id, used FROM sessions WHERE hash = ?')
    .bind(hash)
    .first<{ user_id: string; used: number }>();
  if (!row) return null;
  const now = Date.now();
  if (now - row.used > SESSION_IDLE_MS) {
    await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(hash).run();
    return null;
  }
  if (now - row.used > DAY_MS) await env.DB.prepare('UPDATE sessions SET used = ? WHERE hash = ?').bind(now, hash).run();
  return row.user_id;
}

export async function signOut(env: Env, token: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE hash = ?')
    .bind(await sha256(token))
    .run();
}

/** Sign out every other device of this account (Account, Sign out other devices; and a new email). */
export async function signOutOthers(env: Env, userId: string, token: string | undefined): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND hash <> ?')
    .bind(userId, token ? await sha256(token) : '')
    .run();
}

export async function getUser(env: Env, id: string): Promise<User | null> {
  return env.DB.prepare('SELECT id, email, name, hue, photo FROM users WHERE id = ?').bind(id).first<User>();
}

// ---------- email codes ----------

/**
 * Cloudflare Turnstile on asking for a sign-in code: on only when both its keys are set (the
 * site key in wrangler.toml and the app's .env.production, the secret as a Worker secret).
 */
export const turnstileOn = (env: Env) => !!(env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY);

async function human(env: Env, token: unknown, ip: string): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET!);
  form.append('response', token);
  if (ip !== 'local') form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) return false;
  return !!((await res.json().catch(() => ({}))) as { success?: boolean }).success;
}

/** Email a sign-in code. The same for new and existing addresses, so it reveals nothing. */
export async function sendCode(env: Env, body: { email?: unknown; turnstile?: unknown }, ip: string): Promise<void> {
  const email = cleanEmail(body.email);
  if (!email) throw new Refusal(400, "That doesn't look like an email address.");
  if (turnstileOn(env) && !(await human(env, body.turnstile, ip)))
    throw new Refusal(400, "Boardo couldn't check this browser. Reload the page and try again.");
  const now = Date.now();
  const last = await env.DB.prepare('SELECT sent FROM email_codes WHERE email = ?').bind(email).first<{ sent: number }>();
  if (last && now - last.sent < CODE_GAP_MS) throw new Refusal(429, 'A code is on its way. Wait a minute before asking for another.');
  if (!(await withinLimit(env, `email:${email}`, PER_EMAIL, now)) || !(await withinLimit(env, `ip:${network(ip)}`, PER_IP, now)))
    throw new Refusal(429, 'Too many codes asked for. Try again in an hour.');
  const code = sixDigits();
  const hash = await sha256(`${email}|${code}`);
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO email_codes (email, hash, tries, sent, expires) VALUES (?, ?, 0, ?, ?)').bind(
      email,
      hash,
      now,
      now + CODE_MS,
    ),
    // What has run out or gone unused goes, so no table grows for ever (as Elastic does).
    ...prune(env, now),
  ]);
  try {
    await sendMail(env, {
      to: email,
      subject: `Your Boardo code is ${code}`,
      text: `Your Boardo code is ${code}\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.`,
      html: `<p style="font:16px/1.5 system-ui,sans-serif">Your Boardo code is</p><p style="font:600 28px/1.2 system-ui,sans-serif;letter-spacing:4px">${code}</p><p style="font:14px/1.5 system-ui,sans-serif;color:#5b6170">It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>`,
    });
  } catch (e) {
    // Not sent: asking again mustn't be told one is on its way.
    await env.DB.prepare('DELETE FROM email_codes WHERE email = ? AND hash = ?').bind(email, hash).run();
    if (e instanceof MailSpent)
      throw new Refusal(503, "Boardo has sent all the sign-in codes it can today. Try again tomorrow, or sign in with a passkey if you've added one.");
    throw e;
  }
}

/**
 * Old rate-limit counts, codes nobody used, sessions idle for a year and invites long expired
 * (kept a while after, so an admin can still send one again).
 */
function prune(env: Env, now: number): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM limits WHERE start < ?').bind(now - 2 * DAY_MS),
    env.DB.prepare('DELETE FROM email_codes WHERE expires < ?').bind(now - DAY_MS),
    env.DB.prepare('DELETE FROM oauth_codes WHERE expires < ?').bind(now),
    env.DB.prepare('DELETE FROM invites WHERE expires < ?').bind(now - 30 * DAY_MS),
    env.DB.prepare('DELETE FROM sessions WHERE used < ?').bind(now - SESSION_IDLE_MS),
  ];
}

// ---------- changing one's email ----------

/** The code for changing to `email` is kept apart from that address's sign-in code. */
const changeKey = (email: string) => `change|${email}`;

/**
 * Email a code to a new address, to confirm it before it replaces the account's email. An
 * address another account has is answered the same way, with no email and a code that can't be
 * typed, so this never says who has an account; the change is refused at the code.
 */
export async function sendEmailChange(env: Env, userId: string, body: { email?: unknown }, ip: string): Promise<void> {
  const email = cleanEmail(body.email);
  if (!email) throw new Refusal(400, "That doesn't look like an email address.");
  const user = await getUser(env, userId);
  if (!user) throw new Refusal(401, 'Signed out');
  if (email === user.email) throw new Refusal(400, "That's already your email.");
  const now = Date.now();
  if (!(await withinLimit(env, `change:${userId}`, CHANGES_AN_HOUR, now)))
    throw new Refusal(429, 'Too many codes asked for. Try again in an hour.');
  const key = changeKey(email);
  const last = await env.DB.prepare('SELECT sent FROM email_codes WHERE email = ?').bind(key).first<{ sent: number }>();
  if (last && now - last.sent < CODE_GAP_MS) throw new Refusal(429, 'A code is on its way. Wait a minute before asking for another.');
  if (!(await withinLimit(env, `email:${email}`, PER_EMAIL, now)) || !(await withinLimit(env, `ip:${network(ip)}`, PER_IP, now)))
    throw new Refusal(429, 'Too many codes asked for. Try again in an hour.');
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  const code = sixDigits();
  const hash = await sha256(taken ? randomToken() : `${key}|${userId}|${code}`);
  await env.DB.prepare('INSERT OR REPLACE INTO email_codes (email, hash, tries, sent, expires) VALUES (?, ?, 0, ?, ?)')
    .bind(key, hash, now, now + CODE_MS)
    .run();
  if (taken) return;
  try {
    await sendMail(env, {
      to: email,
      subject: `Your Boardo code is ${code}`,
      text: `Your Boardo code is ${code}\n\nEnter it to use this address for your Boardo account. It works for 10 minutes. If you didn't ask for it, you can ignore this email.`,
      html: `<p style="font:16px/1.5 system-ui,sans-serif">Your Boardo code is</p><p style="font:600 28px/1.2 system-ui,sans-serif;letter-spacing:4px">${code}</p><p style="font:14px/1.5 system-ui,sans-serif;color:#5b6170">Enter it to use this address for your Boardo account. It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>`,
    });
  } catch (e) {
    await env.DB.prepare('DELETE FROM email_codes WHERE email = ? AND hash = ?').bind(key, hash).run();
    throw e;
  }
}

/**
 * Check the code sent to the new address, then make it the account's email. Every other device
 * is signed out, and the old address is told, in case this wasn't its owner.
 */
export async function verifyEmailChange(
  env: Env,
  userId: string,
  body: { email?: unknown; code?: unknown },
  token?: string,
): Promise<User> {
  const email = cleanEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
  const wrong = new Refusal(400, "That code isn't right, or it has expired.");
  if (!email || code.length !== 6) throw wrong;
  const key = changeKey(email);
  if (!(await takeCode(env, key, await sha256(`${key}|${userId}|${code}`)))) throw wrong;
  const before = await getUser(env, userId);
  try {
    await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, userId).run();
  } catch {
    throw new Refusal(409, 'That email is already used by another Boardo account.');
  }
  const user = await getUser(env, userId);
  if (!user) throw new Refusal(401, 'Signed out');
  await signOutOthers(env, userId, token);
  if (before && before.email !== email)
    await sendMail(env, {
      to: before.email,
      subject: 'Your Boardo email was changed',
      text: `The email for your Boardo account is now ${email}, and every other device was signed out.\n\nIf you didn't do this, sign in with ${email} if you can, or reply to this email.`,
      html: `<p style="font:16px/1.5 system-ui,sans-serif">The email for your Boardo account is now <b>${esc(email)}</b>, and every other device was signed out.</p><p style="font:14px/1.5 system-ui,sans-serif;color:#5b6170">If you didn't do this, sign in with ${esc(email)} if you can, or reply to this email.</p>`,
    }).catch((e) => console.error('Telling the old address', e));
  return user;
}

/** Text made safe to put in an email's HTML. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Check a code: signs in, making the account the first time. */
export async function verifyCode(
  env: Env,
  body: { email?: unknown; code?: unknown },
): Promise<{ token: string; user: User; fresh: boolean }> {
  const email = cleanEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
  const wrong = new Refusal(400, "That code isn't right, or it has expired.");
  if (!email || code.length !== 6) throw wrong;
  if (!(await takeCode(env, email, await sha256(`${email}|${code}`)))) throw wrong;
  let user = await env.DB.prepare('SELECT id, email, name, hue, photo FROM users WHERE email = ?').bind(email).first<User>();
  let fresh = false;
  if (!user) {
    const id = randomToken(12);
    const hues = ['indigo', 'cyan', 'lime', 'yellow', 'rose'];
    const hue = hues[crypto.getRandomValues(new Uint8Array(1))[0] % hues.length];
    await env.DB.prepare('INSERT INTO users (id, email, name, hue, created) VALUES (?, ?, NULL, ?, ?)')
      .bind(id, email, hue, Date.now())
      .run();
    user = { id, email, name: null, hue, photo: null };
    fresh = true;
  }
  return { token: await newSession(env, user.id), user, fresh };
}

// ---------- moving to a new address ----------

const HANDOFF_MS = 2 * 60_000;

/**
 * A one-time code for this sign-in to carry over to the app's new address (another origin, so
 * it has none of this one's storage). Good for two minutes; it makes a new session there, and
 * this one ends once it's used.
 */
export async function handoffStart(env: Env, userId: string, token?: string): Promise<{ code: string }> {
  const code = randomToken(24);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM handoffs WHERE expires < ?').bind(now),
    env.DB.prepare('INSERT INTO handoffs (code_hash, user_id, expires, session_hash) VALUES (?, ?, ?, ?)').bind(
      await sha256(code),
      userId,
      now + HANDOFF_MS,
      token ? await sha256(token) : null,
    ),
  ]);
  return { code };
}

/**
 * Sign in with a code from the old address: once, within two minutes. The session it came from
 * ends. With `peek`, only whose it is, so the app can ask "Continue as …?" before using it.
 */
export async function handoffFinish(
  env: Env,
  body: { code?: unknown; peek?: unknown },
): Promise<{ token: string; user: User; fresh: boolean } | { email: string }> {
  const gone = new Refusal(400, 'That link has expired. Sign in here instead.');
  if (typeof body.code !== 'string' || body.code.length > 64) throw gone;
  const hash = await sha256(body.code);
  if (body.peek) {
    const row = await env.DB.prepare('SELECT user_id FROM handoffs WHERE code_hash = ? AND expires >= ?')
      .bind(hash, Date.now())
      .first<{ user_id: string }>();
    const user = row ? await getUser(env, row.user_id) : null;
    if (!user) throw gone;
    return { email: user.email };
  }
  const row = await env.DB.prepare('DELETE FROM handoffs WHERE code_hash = ? AND expires >= ? RETURNING user_id, session_hash')
    .bind(hash, Date.now())
    .first<{ user_id: string; session_hash: string | null }>();
  const user = row ? await getUser(env, row.user_id) : null;
  if (!user) throw gone;
  if (row?.session_hash) await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(row.session_hash).run();
  return { token: await newSession(env, user.id), user, fresh: false };
}

/** Change one's name or colour. */
export async function updateMe(env: Env, userId: string, body: { name?: unknown; hue?: unknown }): Promise<User> {
  const user = await getUser(env, userId);
  if (!user) throw new Refusal(401, 'Signed out');
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > 60) throw new Refusal(400, 'Give a name of up to 60 characters.');
    user.name = name;
  }
  if (body.hue !== undefined) {
    if (!isHue(body.hue)) throw new Refusal(400, 'Pick one of the colours.');
    user.hue = body.hue;
  }
  await env.DB.prepare('UPDATE users SET name = ?, hue = ? WHERE id = ?').bind(user.name, user.hue, userId).run();
  return user;
}

export async function deleteUser(env: Env, userId: string): Promise<void> {
  // The Elastic accounts linked to this one, told once the links have gone.
  const links = await env.DB.prepare('SELECT ext FROM app_tokens WHERE user_id = ? AND scope = ? AND ext IS NOT NULL')
    .bind(userId, LINK)
    .all<{ ext: string }>();
  await env.DB.batch(
    [
      'users WHERE id',
      'sessions WHERE user_id',
      'app_tokens WHERE user_id',
      'oauth_codes WHERE user_id',
      'passkeys WHERE user_id',
      'notes WHERE user_id',
      'push_subs WHERE user_id',
    ].map((w) =>
      env.DB.prepare(`DELETE FROM ${w} = ?`).bind(userId),
    ),
  );
  await linksGone(env, links.results.map((r) => r.ext));
}
