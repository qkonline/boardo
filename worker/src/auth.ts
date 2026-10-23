// Signing in by email. Someone types their address, gets a six-digit code by email and types it
// in; that gives the device a session token, which it sends with every request. A new address
// makes a new account. Only hashes of tokens and codes are stored.

import { cleanEmail, isHue } from './checks';
import type { Env } from './env';
import { sendMail } from './mail';

/** Thrown for anything the app should show: the status and a short reason. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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
/** A device that hasn't been used for this long is signed out. */
const SESSION_IDLE_MS = 365 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;

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

/**
 * Count one use of `key` in an hour-long window; false once it's over `max`. Rate limits for
 * sending codes, per address and per network.
 */
export async function withinLimit(env: Env, key: string, max: number, now = Date.now()): Promise<boolean> {
  // One statement, so many requests at once can't all read the count before any adds to it.
  const row = await env.DB.prepare(
    `INSERT INTO limits (key, count, start) VALUES (?1, 1, ?2)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN ?2 - start > 3600000 THEN 1 ELSE count + 1 END,
       start = CASE WHEN ?2 - start > 3600000 THEN ?2 ELSE start END
     RETURNING count`,
  )
    .bind(key, now)
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
  if (!row || row.hash !== hash) return false;
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

export async function getUser(env: Env, id: string): Promise<User | null> {
  return env.DB.prepare('SELECT id, email, name, hue, photo FROM users WHERE id = ?').bind(id).first<User>();
}

// ---------- email codes ----------

/** Email a sign-in code. The same for new and existing addresses, so it reveals nothing. */
export async function sendCode(env: Env, body: { email?: unknown }, ip: string): Promise<void> {
  const email = cleanEmail(body.email);
  if (!email) throw new Refusal(400, "That doesn't look like an email address.");
  const now = Date.now();
  const last = await env.DB.prepare('SELECT sent FROM email_codes WHERE email = ?').bind(email).first<{ sent: number }>();
  if (last && now - last.sent < CODE_GAP_MS) throw new Refusal(429, 'A code is on its way. Wait a minute before asking for another.');
  if (!(await withinLimit(env, `email:${email}`, PER_EMAIL, now)) || !(await withinLimit(env, `ip:${ip}`, PER_IP, now)))
    throw new Refusal(429, 'Too many codes asked for. Try again in an hour.');
  const code = sixDigits();
  await env.DB.prepare('INSERT OR REPLACE INTO email_codes (email, hash, tries, sent, expires) VALUES (?, ?, 0, ?, ?)')
    .bind(email, await sha256(`${email}|${code}`), now, now + CODE_MS)
    .run();
  await sendMail(env, {
    to: email,
    subject: `Your Boardo code is ${code}`,
    text: `Your Boardo code is ${code}\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.`,
    html: `<p style="font:16px/1.5 system-ui,sans-serif">Your Boardo code is</p><p style="font:600 28px/1.2 system-ui,sans-serif;letter-spacing:4px">${code}</p><p style="font:14px/1.5 system-ui,sans-serif;color:#5b6170">It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>`,
  });
}

// ---------- changing one's email ----------

/** The code for changing to `email` is kept apart from that address's sign-in code. */
const changeKey = (email: string) => `change|${email}`;

/** Email a code to a new address, to confirm it before it replaces the account's email. */
export async function sendEmailChange(env: Env, userId: string, body: { email?: unknown }, ip: string): Promise<void> {
  const email = cleanEmail(body.email);
  if (!email) throw new Refusal(400, "That doesn't look like an email address.");
  const user = await getUser(env, userId);
  if (!user) throw new Refusal(401, 'Signed out');
  if (email === user.email) throw new Refusal(400, "That's already your email.");
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (taken) throw new Refusal(409, 'That email is already used by another Boardo account.');
  const key = changeKey(email);
  const now = Date.now();
  const last = await env.DB.prepare('SELECT sent FROM email_codes WHERE email = ?').bind(key).first<{ sent: number }>();
  if (last && now - last.sent < CODE_GAP_MS) throw new Refusal(429, 'A code is on its way. Wait a minute before asking for another.');
  if (!(await withinLimit(env, `email:${email}`, PER_EMAIL, now)) || !(await withinLimit(env, `ip:${ip}`, PER_IP, now)))
    throw new Refusal(429, 'Too many codes asked for. Try again in an hour.');
  const code = sixDigits();
  await env.DB.prepare('INSERT OR REPLACE INTO email_codes (email, hash, tries, sent, expires) VALUES (?, ?, 0, ?, ?)')
    .bind(key, await sha256(`${key}|${userId}|${code}`), now, now + CODE_MS)
    .run();
  await sendMail(env, {
    to: email,
    subject: `Your Boardo code is ${code}`,
    text: `Your Boardo code is ${code}\n\nEnter it to use this address for your Boardo account. It works for 10 minutes. If you didn't ask for it, you can ignore this email.`,
    html: `<p style="font:16px/1.5 system-ui,sans-serif">Your Boardo code is</p><p style="font:600 28px/1.2 system-ui,sans-serif;letter-spacing:4px">${code}</p><p style="font:14px/1.5 system-ui,sans-serif;color:#5b6170">Enter it to use this address for your Boardo account. It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>`,
  });
}

/** Check the code sent to the new address, then make it the account's email. */
export async function verifyEmailChange(env: Env, userId: string, body: { email?: unknown; code?: unknown }): Promise<User> {
  const email = cleanEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
  const wrong = new Refusal(400, "That code isn't right, or it has expired.");
  if (!email || code.length !== 6) throw wrong;
  const key = changeKey(email);
  if (!(await takeCode(env, key, await sha256(`${key}|${userId}|${code}`)))) throw wrong;
  try {
    await env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, userId).run();
  } catch {
    throw new Refusal(409, 'That email is already used by another Boardo account.');
  }
  const user = await getUser(env, userId);
  if (!user) throw new Refusal(401, 'Signed out');
  return user;
}

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
 * it has none of this one's storage). Good for two minutes; it makes a new session there.
 */
export async function handoffStart(env: Env, userId: string): Promise<{ code: string }> {
  const code = randomToken(24);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM handoffs WHERE expires < ?').bind(now),
    env.DB.prepare('INSERT INTO handoffs (code_hash, user_id, expires) VALUES (?, ?, ?)').bind(await sha256(code), userId, now + HANDOFF_MS),
  ]);
  return { code };
}

/** Sign in with a code from the old address: once, within two minutes. */
export async function handoffFinish(env: Env, body: { code?: unknown }): Promise<{ token: string; user: User; fresh: boolean }> {
  const gone = new Refusal(400, 'That link has expired. Sign in here instead.');
  if (typeof body.code !== 'string' || body.code.length > 64) throw gone;
  const row = await env.DB.prepare('DELETE FROM handoffs WHERE code_hash = ? AND expires >= ? RETURNING user_id')
    .bind(await sha256(body.code), Date.now())
    .first<{ user_id: string }>();
  const user = row ? await getUser(env, row.user_id) : null;
  if (!user) throw gone;
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
  await env.DB.batch(
    ['users WHERE id', 'sessions WHERE user_id', 'app_tokens WHERE user_id', 'oauth_codes WHERE user_id', 'passkeys WHERE user_id'].map((w) =>
      env.DB.prepare(`DELETE FROM ${w} = ?`).bind(userId),
    ),
  );
}
