// Elastic's link (ARCHITECTURE.md section 5), since 23 October 2026: one per Elastic account,
// held by Elastic's Worker and used over a service binding, which only Workers on this
// Cloudflare account can call. Elastic links someone in one of two ways:
// - by email: the address on their Elastic account is one they proved they own with a code
//   there, as they did here, so when a Boardo account has it, it's the same person;
// - by the connect page (OAuth with PKCE, for a Boardo account with another email), the code
//   being swapped by Elastic's Worker rather than the app.
// Its tokens have scope `elastic-link` and work over the binding only: the public `/elastic/*`
// routes take the older `elastic` tokens that app versions from before kept on each device.
// Whenever a board changes something Elastic shows, it's told whose cards changed (`ext`, the
// Elastic account) so their open devices can fetch them at once.

import { WorkerEntrypoint } from 'cloudflare:workers';
import { getUser, Refusal } from './auth';
import { cleanEmail, isId } from './checks';
import { elasticCards, elasticOps } from './elastic';
import type { Env } from './env';
import { LINK } from './notify';
import { appUser, issue, redeem, revokeSelf } from './oauth';

export interface Linked {
  token: string;
  user: { email: string; name: string | null };
}

/** A link for an Elastic account. It replaces any it had (one Boardo account per Elastic account). */
async function link(env: Env, userId: string, ext: string): Promise<Linked | null> {
  const user = await getUser(env, userId);
  if (!user) return null;
  await env.DB.prepare('DELETE FROM app_tokens WHERE scope = ? AND ext = ?').bind(LINK, ext).run();
  return { token: await issue(env, userId, 'elastic', LINK, ext), user: { email: user.email, name: user.name } };
}

async function userByEmail(env: Env, email: unknown): Promise<string | null> {
  const e = cleanEmail(email);
  if (!e) return null;
  const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(e).first<{ id: string }>();
  return row?.id ?? null;
}

/** How many boards the Boardo account with this email is in, or null if there's none. */
export async function lookup(env: Env, email: unknown): Promise<{ boards: number } | null> {
  const id = await userByEmail(env, email);
  if (!id) return null;
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE user_id = ?')
    .bind(id)
    .first<{ n: number }>();
  return { boards: row?.n ?? 0 };
}

export async function linkByEmail(env: Env, email: unknown, ext: unknown): Promise<Linked | null> {
  if (!isId(ext)) return null;
  const id = await userByEmail(env, email);
  return id ? link(env, id, ext) : null;
}

/** The connect page's code, swapped by Elastic's Worker. Throws a Refusal if it's no good. */
export async function exchange(env: Env, body: Record<string, unknown>, ext: unknown): Promise<Linked> {
  if (!isId(ext)) throw new Refusal(400, 'Bad request');
  const { user, clientId } = await redeem(env, body);
  if (clientId !== 'elastic') throw new Refusal(400, 'That code has expired or was already used. Connect again.');
  return (await link(env, user.id, ext))!;
}

/** A device's own token from before: swapped for the account's link, and revoked. */
export async function adopt(env: Env, token: unknown, ext: unknown): Promise<Linked | null> {
  if (!isId(ext)) return null;
  const id = await appUser(env, token, 'elastic');
  if (!id) return null;
  await revokeSelf(env, token);
  return link(env, id, ext);
}

/** What Elastic's Worker calls over its service binding. */
export class ElasticLink extends WorkerEntrypoint<Env> {
  lookup(email: string) {
    return lookup(this.env, email);
  }

  linkByEmail(email: string, ext: string) {
    return linkByEmail(this.env, email, ext);
  }

  /** `{error}` rather than a throw, so the message arrives as it was written. */
  async exchange(body: Record<string, unknown>, ext: string): Promise<Linked | { error: string }> {
    try {
      return await exchange(this.env, body, ext);
    } catch (e) {
      if (e instanceof Refusal) return { error: e.message };
      throw e;
    }
  }

  adopt(token: string, ext: string) {
    return adopt(this.env, token, ext);
  }

  /** The person's cards (null: the link was revoked, or its Boardo account is gone). */
  async cards(token: string) {
    const id = await appUser(this.env, token, LINK);
    return id ? elasticCards(this.env, id) : null;
  }

  async ops(token: string, ops: unknown[]) {
    const id = await appUser(this.env, token, LINK);
    return id ? elasticOps(this.env, id, { ops }) : null;
  }

  async revoke(token: string): Promise<void> {
    await revokeSelf(this.env, token);
  }
}
