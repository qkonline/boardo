// Sign-in codes and their limits (auth.ts), with many requests arriving at once.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeD1 } from '../../test/fake-d1';
import {
  handoffFinish,
  handoffStart,
  network,
  newSession,
  same,
  sendCode,
  sendEmailChange,
  sessionUser,
  sha256,
  signOutOthers,
  verifyCode,
  verifyEmailChange,
  withinLimit,
} from './auth';
import { devOutbox, MAIL_A_DAY, sendMail } from './mail';

let db: ReturnType<typeof fakeD1>['db'];
let env: any;

beforeEach(async () => {
  const f = fakeD1();
  db = f.db;
  env = { DB: f.d1 };
  const now = Date.now();
  db.prepare('INSERT INTO email_codes (email, hash, tries, sent, expires) VALUES (?, ?, 0, ?, ?)').run(
    'ann@x.com',
    await sha256('ann@x.com|123456'),
    now,
    now + 600_000,
  );
  devOutbox.length = 0;
});

afterEach(() => void (devOutbox.length = 0));

/** The code in the last email to `to` (local development keeps them). */
const lastCode = (to: string) => devOutbox.filter((m) => m.to === to).at(-1)?.subject.match(/\d{6}/)?.[0];

describe('sign-in codes', () => {
  it('lets no more requests through than the limit, however many arrive at once', async () => {
    const r = await Promise.all(Array.from({ length: 20 }, () => withinLimit(env, 'ip:1', 6)));
    expect(r.filter(Boolean)).toHaveLength(6);
    // A new hour starts again.
    expect(await withinLimit(env, 'ip:1', 6, Date.now() + 3601_000)).toBe(true);
  });

  it('signs in once with a code sent twice at once', async () => {
    const r = await Promise.allSettled([1, 2].map(() => verifyCode(env, { email: 'ann@x.com', code: '123456' })));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
  });

  it('gives no more tries than allowed to wrong codes sent at once', async () => {
    const wrong = Array.from({ length: 10 }, (_, i) => verifyCode(env, { email: 'ann@x.com', code: String(100000 + i) }));
    await Promise.allSettled(wrong);
    await expect(verifyCode(env, { email: 'ann@x.com', code: '123456' })).rejects.toThrow(/isn't right/);
  });
});

describe('carrying a sign-in to a new address', () => {
  beforeEach(() => db.exec(`INSERT INTO users (id, email, name, created) VALUES ('ann', 'ann@x.com', 'Ann', 1)`));

  it('signs in once with the code, as the same person', async () => {
    const { code } = await handoffStart(env, 'ann');
    const res = await handoffFinish(env, { code });
    expect(res.user.id).toBe('ann');
    expect(res.fresh).toBe(false);
    expect(await sessionUser(env, res.token)).toBe('ann');
    await expect(handoffFinish(env, { code })).rejects.toThrow(/expired/);
  });

  it('refuses a made-up code, or one more than two minutes old', async () => {
    await expect(handoffFinish(env, { code: 'nope' })).rejects.toThrow(/expired/);
    const { code } = await handoffStart(env, 'ann');
    db.prepare('UPDATE handoffs SET expires = ?').run(Date.now() - 1);
    await expect(handoffFinish(env, { code })).rejects.toThrow(/expired/);
  });

  it('keeps only the code, never stored as it is', async () => {
    const { code } = await handoffStart(env, 'ann');
    expect(db.prepare('SELECT code_hash FROM handoffs').get()).toEqual({ code_hash: await sha256(code) });
  });

  it('ends the session it came from once it is used', async () => {
    const old = await newSession(env, 'ann');
    const { code } = await handoffStart(env, 'ann', old);
    expect(await sessionUser(env, old)).toBe('ann');
    await handoffFinish(env, { code });
    expect(await sessionUser(env, old)).toBeNull();
  });

  it('says whose it is without using it, so the app can ask first', async () => {
    const old = await newSession(env, 'ann');
    const { code } = await handoffStart(env, 'ann', old);
    expect(await handoffFinish(env, { code, peek: true })).toEqual({ email: 'ann@x.com' });
    expect(await sessionUser(env, old)).toBe('ann');
    expect(await handoffFinish(env, { code })).toMatchObject({ user: { id: 'ann' } });
  });
});

describe('networks', () => {
  it('counts an IPv6 address as its /64, and an IPv4 one as itself', () => {
    expect(network('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(network('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(network('2001:DB8:0001:0002:0:0:0:ffff')).toBe('2001:db8:1:2::/64');
    expect(network('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(network('::1')).toBe('0:0:0:0::/64');
    expect(network('fe80::1%en0')).toBe('fe80:0:0:0::/64');
    expect(network('203.0.113.9')).toBe('203.0.113.9');
    expect(network('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('limits a whole /64 together', async () => {
    const ips = Array.from({ length: 31 }, (_, i) => `2001:db8:1:2::${(i + 1).toString(16)}`);
    const sent = await Promise.allSettled(ips.map((ip, i) => sendCode({ ...env, DEV_MAIL: '1' }, { email: `p${i}@x.com` }, ip)));
    expect(sent.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

describe('comparing secrets', () => {
  it('matches only the same string', () => {
    expect(same('abc', 'abc')).toBe(true);
    expect(same('abc', 'abd')).toBe(false);
    expect(same('abc', 'ab')).toBe(false);
  });
});

describe("the day's tries at codes", () => {
  it('stops after 30 tries at sent codes in a day, whatever the code', async () => {
    let refused = 0;
    for (let round = 0; round < 7; round++) {
      db.prepare('UPDATE email_codes SET tries = 0').run();
      for (let i = 0; i < 5; i++)
        await verifyCode(env, { email: 'ann@x.com', code: '000000' }).catch((e) => /today/.test(e.message) && refused++);
    }
    expect(refused).toBe(5);
    db.prepare('UPDATE email_codes SET tries = 0').run();
    await expect(verifyCode(env, { email: 'ann@x.com', code: '123456' })).rejects.toThrow(/today/);
  });

  it("doesn't count guesses at an address with no code waiting, so they can't lock it", async () => {
    for (let i = 0; i < 40; i++) await verifyCode(env, { email: 'bob@x.com', code: '000000' }).catch(() => {});
    expect(db.prepare("SELECT 1 FROM limits WHERE key = 'tries:bob@x.com'").get()).toBeUndefined();
    expect((await verifyCode(env, { email: 'ann@x.com', code: '123456' })).user.email).toBe('ann@x.com');
  });
});

describe("the day's email", () => {
  const dev = () => ({ ...env, DEV_MAIL: '1' });

  it(`sends at most ${MAIL_A_DAY} emails a day, of every kind`, async () => {
    for (let i = 0; i < MAIL_A_DAY; i++) await sendMail(dev(), { to: `p${i}@x.com`, subject: 'Hi', text: 'Hi' });
    await expect(sendMail(dev(), { to: 'one@x.com', subject: 'Hi', text: 'Hi' })).rejects.toMatchObject({ status: 503 });
    expect(devOutbox).toHaveLength(MAIL_A_DAY);
    // A new day starts again.
    db.prepare("UPDATE limits SET start = start - 86400001 WHERE key = 'mail:day'").run();
    await sendMail(dev(), { to: 'one@x.com', subject: 'Hi', text: 'Hi' });
  });

  it('says so plainly when a sign-in code can\'t go, and lets the person ask again later', async () => {
    db.prepare("INSERT INTO limits (key, count, start) VALUES ('mail:day', ?, ?)").run(MAIL_A_DAY, Date.now());
    await expect(sendCode(dev(), { email: 'cy@x.com' }, '203.0.113.9')).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/sign-in codes it can today/),
    });
    expect(db.prepare("SELECT 1 FROM email_codes WHERE email = 'cy@x.com'").get()).toBeUndefined();
  });
});

describe('tidying up as codes are sent', () => {
  it('drops old counts, used-up codes, idle sessions and long-expired invites', async () => {
    const now = Date.now();
    const day = 86_400_000;
    db.prepare("INSERT INTO limits (key, count, start) VALUES ('old', 1, ?), ('new', 1, ?)").run(now - 3 * day, now);
    db.prepare("INSERT INTO email_codes (email, hash, tries, sent, expires) VALUES ('gone@x.com', 'h', 0, 0, ?)").run(now - 2 * day);
    db.prepare("INSERT INTO oauth_codes (code_hash, user_id, client_id, redirect_uri, challenge, scope, expires) VALUES ('c', 'u', 'elastic', 'r', 'x', 'elastic', ?)").run(now - 1);
    db.prepare("INSERT INTO sessions (hash, user_id, created, used) VALUES ('idle', 'u', 0, ?), ('live', 'u', 0, ?)").run(now - 366 * day, now);
    db.prepare(
      "INSERT INTO invites (id, board_id, email, role, token_hash, invited_by, created, expires) VALUES ('i1', 'b', 'a@x.com', 'member', 't1', 'u', 0, ?), ('i2', 'b', 'b@x.com', 'member', 't2', 'u', 0, ?)",
    ).run(now - 31 * day, now - day);
    await sendCode({ ...env, DEV_MAIL: '1' }, { email: 'cy@x.com' }, '203.0.113.9');
    expect(db.prepare('SELECT key FROM limits ORDER BY key').all().map((r) => r.key)).not.toContain('old');
    expect(db.prepare("SELECT 1 FROM email_codes WHERE email = 'gone@x.com'").get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM oauth_codes').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT hash FROM sessions').all()).toEqual([{ hash: 'live' }]);
    expect(db.prepare('SELECT id FROM invites').all()).toEqual([{ id: 'i2' }]);
  });
});

describe('changing one\'s email', () => {
  beforeEach(() => db.exec(`INSERT INTO users (id, email, name, created) VALUES ('ann', 'ann@x.com', 'Ann', 1), ('bob', 'bob@x.com', 'Bob', 1)`));
  const dev = () => ({ ...env, DEV_MAIL: '1' });

  it('answers an address another account has as if a code went, and refuses it at the code', async () => {
    await sendEmailChange(dev(), 'ann', { email: 'bob@x.com' }, '203.0.113.9');
    expect(devOutbox).toHaveLength(0);
    await expect(sendEmailChange(dev(), 'ann', { email: 'bob@x.com' }, '203.0.113.9')).rejects.toThrow(/on its way/);
    await expect(verifyEmailChange(dev(), 'ann', { email: 'bob@x.com', code: '000000' })).rejects.toThrow(/isn't right/);
  });

  it('signs out every other device and tells the old address', async () => {
    const here = await newSession(env, 'ann');
    const there = await newSession(env, 'ann');
    await sendEmailChange(dev(), 'ann', { email: 'ann@new.com' }, '203.0.113.9');
    const user = await verifyEmailChange(dev(), 'ann', { email: 'ann@new.com', code: lastCode('ann@new.com') }, here);
    expect(user.email).toBe('ann@new.com');
    expect(await sessionUser(env, here)).toBe('ann');
    expect(await sessionUser(env, there)).toBeNull();
    expect(devOutbox.at(-1)).toMatchObject({ to: 'ann@x.com', subject: 'Your Boardo email was changed' });
  });

  it('is limited per account', async () => {
    const r = [];
    for (let i = 0; i < 6; i++) r.push(await sendEmailChange(dev(), 'ann', { email: `n${i}@x.com` }, '203.0.113.9').then(() => 'ok', (e) => e.message));
    expect(r.slice(0, 5)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(r[5]).toMatch(/Too many/);
  });
});

describe('signing out other devices', () => {
  it('keeps only this one', async () => {
    db.exec(`INSERT INTO users (id, email, name, created) VALUES ('ann', 'ann@x.com', 'Ann', 1)`);
    const here = await newSession(env, 'ann');
    const there = await newSession(env, 'ann');
    await signOutOthers(env, 'ann', here);
    expect(await sessionUser(env, here)).toBe('ann');
    expect(await sessionUser(env, there)).toBeNull();
  });
});
