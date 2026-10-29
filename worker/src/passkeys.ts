// Passkeys, as in Elastic: after making an account with an email code, a person can add a
// passkey on each device, and from then on sign in with Face ID, Touch ID or a security key, with
// no code to wait for. The relying party is the site the app is served from (kaiserkhan.com),
// which Elastic shares, so Boardo's passkeys are named "Boardo: <email>" to tell them apart in
// the device's list, and a passkey that isn't Boardo's gets a clear message.
//
// A passkey answer is taken only from the app's own address (APP_URL), and the local copies
// in development: any page on kaiserkhan.com can ask the device for a kaiserkhan.com passkey,
// so the origin the device signed is what tells Boardo's own page apart. The device must also
// check it's its owner (Face ID, a PIN), both to add a passkey and to sign in with one.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { b64url, getUser, newSession, randomToken, Refusal, type User } from './auth';
import { type Env, isDev, list } from './env';

const CHALLENGE_MS = 5 * 60_000;
const MAX_KEYS = 20;

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/**
 * The passkey site: RP_ID (kaiserkhan.com) for the page on it or any of its subdomains, so a
 * passkey made at kaiserkhan.com/boardo/ works at boardo.kaiserkhan.com; otherwise the page's
 * own host (localhost in development).
 */
function rpOf(env: Env, origin: string) {
  if (!origins(env).includes(origin)) throw new Refusal(403, 'Passkeys work only on Boardo itself.');
  const host = new URL(origin).hostname;
  const root = env.RP_ID;
  return { rpID: root && (host === root || host.endsWith('.' + root)) ? root : host, origin };
}

/** The pages a passkey answer is taken from: the app's own address, and local copies in development. */
export function origins(env: Env): string[] {
  return [new URL(env.APP_URL).origin, ...(isDev(env) ? list(env.DEV_ORIGINS) : [])];
}

async function saveChallenge(env: Env, challenge: string, userId: string, purpose: 'add' | 'login') {
  const id = randomToken(16);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM challenges WHERE expires < ?').bind(now),
    env.DB.prepare('INSERT INTO challenges (id, challenge, user_id, purpose, expires) VALUES (?, ?, ?, ?, ?)').bind(
      id,
      challenge,
      userId,
      purpose,
      now + CHALLENGE_MS,
    ),
  ]);
  return id;
}

async function takeChallenge(env: Env, id: unknown, purpose: 'add' | 'login') {
  const late = new Refusal(400, 'That took too long. Try again.');
  if (typeof id !== 'string' || id.length > 64) throw late;
  const row = await env.DB.prepare('DELETE FROM challenges WHERE id = ? RETURNING challenge, user_id, purpose, expires')
    .bind(id)
    .first<{ challenge: string; user_id: string; purpose: string; expires: number }>();
  if (!row || row.purpose !== purpose || row.expires < Date.now()) throw late;
  return row;
}

/** Options for adding a passkey to the signed-in account, on this device. */
export async function registerStart(env: Env, origin: string, userId: string) {
  const user = await getUser(env, userId);
  if (!user) throw new Refusal(401, 'Signed out');
  const keys = await env.DB.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?')
    .bind(userId)
    .all<{ id: string; transports: string | null }>();
  if (keys.results.length >= MAX_KEYS) throw new Refusal(400, 'This account has as many passkeys as it can. Remove one first.');
  const options = await generateRegistrationOptions({
    rpName: 'Boardo',
    rpID: rpOf(env, origin).rpID,
    userName: `Boardo: ${user.email}`,
    userDisplayName: `Boardo: ${user.name ?? user.email}`,
    userID: new TextEncoder().encode(`boardo:${userId}`) as Uint8Array<ArrayBuffer>,
    attestationType: 'none',
    excludeCredentials: keys.results.map((k) => ({ id: k.id, transports: k.transports ? JSON.parse(k.transports) : undefined })),
    // Signing in needs the device to check its owner, so a passkey that can't is never made.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { challengeId: await saveChallenge(env, options.challenge, userId, 'add'), options };
}

/** A short name for the device a passkey was made on, from its browser. */
function deviceLabel(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'This device';
}

export async function registerFinish(
  env: Env,
  origin: string,
  userId: string,
  body: { challengeId?: unknown; response?: unknown },
  ua: string,
) {
  const ch = await takeChallenge(env, body.challengeId, 'add');
  if (ch.user_id !== userId) throw new Refusal(400, 'That took too long. Try again.');
  let v;
  try {
    v = await verifyRegistrationResponse({
      response: body.response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
      expectedChallenge: ch.challenge,
      expectedOrigin: origins(env),
      expectedRPID: rpOf(env, origin).rpID,
      requireUserVerification: true,
    });
  } catch {
    throw new Refusal(400, "That passkey couldn't be checked. Try again.");
  }
  if (!v.verified) throw new Refusal(400, "That passkey couldn't be checked. Try again.");
  const { credential } = v.registrationInfo;
  try {
    await env.DB.prepare(
      'INSERT INTO passkeys (id, user_id, public_key, counter, transports, label, created) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        credential.id,
        userId,
        b64url(credential.publicKey),
        credential.counter,
        credential.transports ? JSON.stringify(credential.transports) : null,
        deviceLabel(ua),
        Date.now(),
      )
      .run();
  } catch {
    throw new Refusal(409, 'That passkey is already in use.');
  }
}

/** Options for signing in: any passkey made for this site can answer. */
export async function loginStart(env: Env, origin: string) {
  const options = await generateAuthenticationOptions({ rpID: rpOf(env, origin).rpID, userVerification: 'required' });
  return { challengeId: await saveChallenge(env, options.challenge, '', 'login'), options };
}

export async function loginFinish(
  env: Env,
  origin: string,
  body: { challengeId?: unknown; response?: unknown },
): Promise<{ token: string; user: User; fresh: boolean }> {
  const ch = await takeChallenge(env, body.challengeId, 'login');
  const response = body.response as Parameters<typeof verifyAuthenticationResponse>[0]['response'];
  const id = response && typeof response === 'object' ? response.id : null;
  const key =
    typeof id === 'string' && id.length <= 1024
      ? await env.DB.prepare('SELECT user_id, public_key, counter, transports FROM passkeys WHERE id = ?')
          .bind(id)
          .first<{ user_id: string; public_key: string; counter: number; transports: string | null }>()
      : null;
  if (!key)
    throw new Refusal(
      400,
      "That passkey isn't one of Boardo's. Pick the one that starts with \"Boardo\", or sign in with your email.",
    );
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ch.challenge,
      expectedOrigin: origins(env),
      expectedRPID: rpOf(env, origin).rpID,
      credential: {
        id: id!,
        publicKey: fromB64url(key.public_key),
        counter: key.counter,
        transports: key.transports ? JSON.parse(key.transports) : undefined,
      },
      requireUserVerification: true,
    });
  } catch {
    throw new Refusal(400, "That passkey couldn't be checked. Try again.");
  }
  if (!v.verified) throw new Refusal(400, "That passkey couldn't be checked. Try again.");
  await env.DB.prepare('UPDATE passkeys SET counter = ?, used = ? WHERE id = ?')
    .bind(v.authenticationInfo.newCounter, Date.now(), id)
    .run();
  const user = await getUser(env, key.user_id);
  if (!user) throw new Refusal(400, "That passkey's account was deleted.");
  return { token: await newSession(env, user.id), user, fresh: false };
}

export async function listPasskeys(env: Env, userId: string) {
  const rows = await env.DB.prepare('SELECT id, label, created, used FROM passkeys WHERE user_id = ? ORDER BY created')
    .bind(userId)
    .all<{ id: string; label: string; created: number; used: number | null }>();
  return { passkeys: rows.results };
}

export async function removePasskey(env: Env, userId: string, body: { id?: unknown }) {
  if (typeof body.id !== 'string' || body.id.length > 1024) return;
  await env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').bind(body.id, userId).run();
}
