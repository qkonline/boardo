// Sign-in codes and their limits (auth.ts), with many requests arriving at once.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeD1 } from '../../test/fake-d1';
import { sha256, verifyCode, withinLimit } from './auth';

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
});

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
